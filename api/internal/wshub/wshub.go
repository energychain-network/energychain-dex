package wshub

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
)

// Hub fans Redis pub/sub messages out to connected WebSocket clients.
// Clients pick which channels to subscribe to via {"op":"sub","ch":["dex:swaps"]}.
type Hub struct {
	r        *redis.Client
	upgrader websocket.Upgrader
	log      zerolog.Logger

	mu       sync.RWMutex
	channels map[string]map[*client]struct{} // channel -> clients
}

type client struct {
	conn  *websocket.Conn
	send  chan []byte
	subs  map[string]struct{}
	mu    sync.Mutex
}

type subMsg struct {
	Op string   `json:"op"`
	Ch []string `json:"ch"`
}

func New(redisAddr string, log zerolog.Logger) *Hub {
	return &Hub{
		r: redis.NewClient(&redis.Options{Addr: redisAddr}),
		upgrader: websocket.Upgrader{
			CheckOrigin:     func(r *http.Request) bool { return true },
			ReadBufferSize:  1024,
			WriteBufferSize: 8192,
		},
		log:      log,
		channels: map[string]map[*client]struct{}{},
	}
}

// Run starts the Redis pub/sub fan-out loop. Blocks; call in a goroutine.
func (h *Hub) Run(ctx context.Context) {
	ps := h.r.PSubscribe(ctx, "dex:*")
	defer ps.Close()
	ch := ps.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			h.fanout(msg.Channel, []byte(msg.Payload))
		}
	}
}

func (h *Hub) fanout(channel string, payload []byte) {
	h.mu.RLock()
	subs := h.channels[channel]
	// Also fan out wildcard subscriptions like "dex:candles" -> "dex:candles:*"
	for ch, set := range h.channels {
		if ch == channel {
			continue
		}
		if strings.HasSuffix(ch, ":*") && strings.HasPrefix(channel, strings.TrimSuffix(ch, "*")) {
			for c := range set {
				if subs == nil {
					subs = map[*client]struct{}{}
				}
				subs[c] = struct{}{}
			}
		}
	}
	h.mu.RUnlock()

	frame, _ := json.Marshal(map[string]any{
		"channel": channel,
		"data":    json.RawMessage(payload),
	})
	for c := range subs {
		select {
		case c.send <- frame:
		default:
			// Slow consumer — drop the message; the connection will catch up
			// or be closed by the write deadline.
		}
	}
}

// ServeHTTP upgrades the connection and starts the per-client read/write loops.
func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	c := &client{
		conn: conn,
		send: make(chan []byte, 256),
		subs: map[string]struct{}{},
	}
	go h.writeLoop(c)
	h.readLoop(c)
}

func (h *Hub) readLoop(c *client) {
	defer h.disconnect(c)
	c.conn.SetReadLimit(2048)
	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})
	for {
		_, msg, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		var m subMsg
		if err := json.Unmarshal(msg, &m); err != nil {
			continue
		}
		switch m.Op {
		case "sub":
			for _, ch := range m.Ch {
				h.subscribe(c, ch)
			}
		case "unsub":
			for _, ch := range m.Ch {
				h.unsubscribe(c, ch)
			}
		}
	}
}

func (h *Hub) writeLoop(c *client) {
	tk := time.NewTicker(25 * time.Second)
	defer tk.Stop()
	defer c.conn.Close()
	for {
		select {
		case msg, ok := <-c.send:
			if !ok {
				return
			}
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-tk.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (h *Hub) subscribe(c *client, channel string) {
	c.mu.Lock()
	c.subs[channel] = struct{}{}
	c.mu.Unlock()
	h.mu.Lock()
	if h.channels[channel] == nil {
		h.channels[channel] = map[*client]struct{}{}
	}
	h.channels[channel][c] = struct{}{}
	h.mu.Unlock()
}

func (h *Hub) unsubscribe(c *client, channel string) {
	c.mu.Lock()
	delete(c.subs, channel)
	c.mu.Unlock()
	h.mu.Lock()
	if set, ok := h.channels[channel]; ok {
		delete(set, c)
		if len(set) == 0 {
			delete(h.channels, channel)
		}
	}
	h.mu.Unlock()
}

func (h *Hub) disconnect(c *client) {
	c.mu.Lock()
	subs := make([]string, 0, len(c.subs))
	for ch := range c.subs {
		subs = append(subs, ch)
	}
	c.mu.Unlock()
	h.mu.Lock()
	for _, ch := range subs {
		if set, ok := h.channels[ch]; ok {
			delete(set, c)
			if len(set) == 0 {
				delete(h.channels, ch)
			}
		}
	}
	h.mu.Unlock()
	close(c.send)
	c.conn.Close()
}
