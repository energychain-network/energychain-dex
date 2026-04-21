package main

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"energychain/dex/api/internal/config"
	"energychain/dex/api/internal/handlers"
	"energychain/dex/api/internal/metrics"
	"energychain/dex/api/internal/middleware"
	"energychain/dex/api/internal/routing"
	"energychain/dex/api/internal/storage"
	"energychain/dex/api/internal/wshub"
)

// Build-stamped at link time:  -ldflags "-X main.version=... -X main.commit=..."
var (
	version = "dev"
	commit  = "none"
)

func main() {
	cfg := config.Load()
	zerolog.TimeFieldFormat = time.RFC3339Nano
	lvl, _ := zerolog.ParseLevel(cfg.LogLevel)
	if lvl == zerolog.NoLevel {
		lvl = zerolog.InfoLevel
	}
	log := zerolog.New(os.Stdout).Level(lvl).With().
		Timestamp().Str("service", "dex-api").Logger()

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	store, err := storage.Open(ctx, cfg.PGDSN)
	if err != nil {
		log.Fatal().Err(err).Msg("open postgres")
	}
	defer store.Close()

	rdb := redis.NewClient(&redis.Options{Addr: cfg.RedisAddr})
	defer rdb.Close()

	rt := routing.New(store.Pool(), cfg.ChainID)
	if err := rt.Load(ctx); err != nil {
		log.Warn().Err(err).Msg("router initial load")
	}
	go func() {
		t := time.NewTicker(30 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				if err := rt.Load(ctx); err != nil {
					log.Warn().Err(err).Msg("router refresh")
				}
			}
		}
	}()

	hub := wshub.New(cfg.RedisAddr, log)
	go hub.Run(ctx)

	api := &handlers.API{
		Pool:    store.Pool(),
		Redis:   rdb,
		Router:  rt,
		ChainID: cfg.ChainID,
		WECY:    cfg.WECY,
	}

	metrics.MustRegister()
	go func() {
		if err := metrics.Serve(cfg.PromListen); err != nil {
			log.Error().Err(err).Msg("metrics server")
		}
	}()

	keyTier := apiKeyResolver(store, log)
	rl := middleware.NewRateLimit(cfg.RatePublic, cfg.RatePartner, keyTier)

	r := chi.NewRouter()
	r.Use(middleware.CORS(cfg.CORSOrigins))
	r.Use(rl.Middleware())

	startedAt := time.Now().UTC()
	// Liveness: the process is up. Kubernetes uses this to decide whether to
	// restart the pod, so it must NOT depend on external systems – otherwise
	// a transient Postgres blip would loop us through CrashLoopBackOff.
	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status":     "ok",
			"uptime_sec": int(time.Since(startedAt).Seconds()),
		})
	})
	// Readiness: the process is able to serve real traffic. We check Postgres,
	// Redis and the indexer cursor freshness (which proxies for "EVM RPC is
	// producing blocks" because the indexer writes the cursor only after a
	// successful eth_blockNumber + log fetch). Each check has its own short
	// timeout so a single slow dep can't stall the probe.
	r.Get("/readyz", func(w http.ResponseWriter, r *http.Request) {
		out := map[string]any{}
		status := http.StatusOK

		// Postgres
		{
			ctx, cancel := context.WithTimeout(r.Context(), 750*time.Millisecond)
			if err := store.Pool().Ping(ctx); err != nil {
				out["postgres"] = map[string]any{"ok": false, "error": err.Error()}
				status = http.StatusServiceUnavailable
			} else {
				out["postgres"] = map[string]any{"ok": true}
			}
			cancel()
		}
		// Redis
		{
			ctx, cancel := context.WithTimeout(r.Context(), 500*time.Millisecond)
			if err := rdb.Ping(ctx).Err(); err != nil {
				out["redis"] = map[string]any{"ok": false, "error": err.Error()}
				status = http.StatusServiceUnavailable
			} else {
				out["redis"] = map[string]any{"ok": true}
			}
			cancel()
		}
		// Indexer cursor (proxies EVM RPC liveness). We accept up to 60s of
		// staleness before flagging not-ready; that is long enough to absorb
		// short reorg pauses but short enough to fail over before users
		// notice stale charts. Schema note: the cursor table has a single
		// row per stream and no chain_id column — this DEX is single-chain
		// per deployment, so the chain id lives in dex-api config rather
		// than the cursor row.
		{
			ctx, cancel := context.WithTimeout(r.Context(), 750*time.Millisecond)
			var height int64
			var updatedAt time.Time
			err := store.Pool().QueryRow(ctx,
				`SELECT height, updated_at FROM indexer_cursor WHERE stream='main'`,
			).Scan(&height, &updatedAt)
			cancel()
			if err != nil {
				out["indexer"] = map[string]any{"ok": false, "error": err.Error()}
				status = http.StatusServiceUnavailable
			} else {
				lag := time.Since(updatedAt)
				// 120s tolerance accommodates the worst case observed in
				// production: a long reorg-rewind tick on a busy block.
				ok := lag <= 120*time.Second
				out["indexer"] = map[string]any{
					"ok":         ok,
					"height":     height,
					"lag_sec":    int(lag.Seconds()),
				}
				if !ok {
					status = http.StatusServiceUnavailable
				}
			}
		}

		w.Header().Set("content-type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(out)
	})
	r.Get("/version", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"service":     "dex-api",
			"version":     version,
			"commit":      commit,
			"go":          runtime.Version(),
			"started_at":  startedAt.Format(time.RFC3339),
			"chain_id":    cfg.ChainID,
			"factory":     cfg.Factory,
			"router":      cfg.Router,
			"wecy":        cfg.WECY,
			"server_time": time.Now().UTC().Format(time.RFC3339),
		})
	})
	r.Get("/ws", hub.ServeHTTP)

	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/overview", metrics.Wrap("overview", api.Overview))
		r.Get("/pairs", metrics.Wrap("pairs.list", api.ListPairs))
		r.Get("/pairs/{address}", metrics.Wrap("pairs.get", api.GetPair))
		r.Get("/pairs/{address}/candles", metrics.Wrap("pairs.candles", api.Candles))
		r.Get("/pairs/{address}/swaps", metrics.Wrap("pairs.swaps", api.PairSwaps))
		r.Get("/pairs/{address}/liquidity", metrics.Wrap("pairs.liquidity", api.PairLiquidityEvents))
		r.Get("/swaps", metrics.Wrap("swaps", api.RecentSwaps))
		r.Post("/quote", metrics.Wrap("quote", api.Quote))
		r.Get("/tokens", metrics.Wrap("tokens.list", api.ListTokens))
		r.Get("/tokens/{address}", metrics.Wrap("tokens.get", api.GetToken))
		r.Get("/portfolio/{owner}", metrics.Wrap("portfolio", api.Portfolio))
		r.Get("/search", metrics.Wrap("search", api.Search))
		// Self-service API keys (wallet signature gated). The challenge is
		// open and idempotent; the mutating endpoints verify the EIP-191
		// signature server-side before touching api_keys.
		r.Get("/apikeys/challenge", metrics.Wrap("apikeys.challenge", api.APIKeyChallenge))
		r.Post("/apikeys/issue", metrics.Wrap("apikeys.issue", api.APIKeyIssue))
		r.Post("/apikeys/list", metrics.Wrap("apikeys.list", api.APIKeyList))
		r.Post("/apikeys/revoke", metrics.Wrap("apikeys.revoke", api.APIKeyRevoke))
	})

	srv := &http.Server{
		Addr:              cfg.Listen,
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       90 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutCtx, c := context.WithTimeout(context.Background(), 10*time.Second)
		defer c()
		_ = srv.Shutdown(shutCtx)
	}()
	log.Info().Str("listen", cfg.Listen).Msg("dex-api ready")
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Error().Err(err).Msg("api server")
		os.Exit(1)
	}
}

// apiKeyResolver consults the api_keys table on every miss; results are
// cached by the rate limiter's bucket map so the lookup is rare in steady
// state. We hash with sha256 client-side (Go) so the column index is a
// straight bytea comparison and the query plan is a primary-key lookup.
func apiKeyResolver(store *storage.Store, log zerolog.Logger) func(string) (string, bool) {
	return func(rawKey string) (string, bool) {
		if rawKey == "" {
			return "", false
		}
		sum := sha256.Sum256([]byte(rawKey))
		var tier string
		err := store.Pool().QueryRow(context.Background(),
			`SELECT tier FROM api_keys WHERE key_hash = $1 AND enabled = TRUE`,
			sum[:]).Scan(&tier)
		if err != nil {
			return "", false
		}
		// best-effort timestamp; ignore errors, this is purely for ops visibility
		_, _ = store.Pool().Exec(context.Background(),
			`UPDATE api_keys SET last_seen_at = NOW() WHERE key_hash = $1`, sum[:])
		return tier, true
	}
}
