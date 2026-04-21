package middleware

import (
	"net/http"
	"strings"
	"sync"

	"golang.org/x/time/rate"
)

// CORS is permissive by default but constrains methods/headers. The frontend
// is the primary consumer; partners use the API key flow which is gated
// upstream of CORS.
func CORS(allowed []string) func(http.Handler) http.Handler {
	allowAll := false
	for _, o := range allowed {
		if o == "*" {
			allowAll = true
			break
		}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if allowAll {
				w.Header().Set("Access-Control-Allow-Origin", "*")
			} else if contains(allowed, origin) {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
			}
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RateLimit applies a per-IP token bucket. Partners (X-API-Key header
// recognized) get a higher bucket. Unknown keys fall back to public.
type RateLimit struct {
	publicRPM  int
	partnerRPM int

	mu      sync.Mutex
	buckets map[string]*rate.Limiter
	keyTier func(key string) (string, bool) // tier, ok
}

func NewRateLimit(publicRPM, partnerRPM int, keyTier func(string) (string, bool)) *RateLimit {
	return &RateLimit{
		publicRPM:  publicRPM,
		partnerRPM: partnerRPM,
		buckets:    map[string]*rate.Limiter{},
		keyTier:    keyTier,
	}
}

func (rl *RateLimit) Middleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			tier := "public"
			ip := clientIP(r)
			key := r.Header.Get("X-API-Key")
			bucketKey := "ip:" + ip
			rpm := rl.publicRPM
			if key != "" && rl.keyTier != nil {
				if t, ok := rl.keyTier(key); ok {
					tier = t
					bucketKey = "key:" + key
					if tier == "partner" || tier == "internal" {
						rpm = rl.partnerRPM
					}
				}
			}
			lim := rl.limiter(bucketKey, rpm)
			if !lim.Allow() {
				w.Header().Set("Retry-After", "1")
				http.Error(w, `{"error":"rate limit exceeded"}`, http.StatusTooManyRequests)
				return
			}
			_ = tier
			next.ServeHTTP(w, r)
		})
	}
}

func (rl *RateLimit) limiter(key string, rpm int) *rate.Limiter {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	if l, ok := rl.buckets[key]; ok {
		return l
	}
	l := rate.NewLimiter(rate.Limit(float64(rpm)/60.0), rpm)
	rl.buckets[key] = l
	return l
}

func clientIP(r *http.Request) string {
	if v := r.Header.Get("X-Forwarded-For"); v != "" {
		if i := strings.IndexByte(v, ','); i >= 0 {
			return strings.TrimSpace(v[:i])
		}
		return strings.TrimSpace(v)
	}
	if v := r.Header.Get("X-Real-IP"); v != "" {
		return strings.TrimSpace(v)
	}
	host := r.RemoteAddr
	if i := strings.LastIndexByte(host, ':'); i >= 0 {
		host = host[:i]
	}
	return host
}

func contains(xs []string, s string) bool {
	for _, x := range xs {
		if x == s {
			return true
		}
	}
	return false
}
