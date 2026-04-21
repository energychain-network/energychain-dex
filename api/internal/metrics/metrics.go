package metrics

import (
	"net/http"
	"strconv"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var (
	HTTPRequests = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "dex_api_http_requests_total",
		Help: "HTTP request counts by route + status.",
	}, []string{"route", "status"})

	HTTPDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "dex_api_http_duration_seconds",
		Help:    "HTTP duration histogram by route.",
		Buckets: []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5},
	}, []string{"route"})

	WSClients = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "dex_api_ws_clients",
		Help: "Number of currently connected WS clients.",
	})

	CacheHits = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "dex_api_cache_hits_total",
		Help: "Cache hits / misses by key prefix.",
	}, []string{"layer", "result"})
)

func MustRegister() {
	prometheus.MustRegister(HTTPRequests, HTTPDuration, WSClients, CacheHits)
}

func Serve(addr string) error {
	mux := http.NewServeMux()
	mux.Handle("/metrics", promhttp.Handler())
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	srv := &http.Server{Addr: addr, Handler: mux}
	return srv.ListenAndServe()
}

// Wrap is a chi-compatible middleware that records counters + histogram.
func Wrap(route string, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sr := &statusRecorder{ResponseWriter: w, status: 200}
		t0 := time.Now()
		h(sr, r)
		HTTPRequests.WithLabelValues(route, strconv.Itoa(sr.status)).Inc()
		HTTPDuration.WithLabelValues(route).Observe(time.Since(t0).Seconds())
	}
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(c int) {
	s.status = c
	s.ResponseWriter.WriteHeader(c)
}
