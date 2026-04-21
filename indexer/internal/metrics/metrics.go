package metrics

import (
	"fmt"
	"net/http"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	dto "github.com/prometheus/client_model/go"
)

var (
	ChainHead = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "dex_indexer_chain_head",
		Help: "Latest block number observed from the EVM RPC.",
	})
	ProcessedHeight = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "dex_indexer_processed_height",
		Help: "Highest block number durably written to Postgres.",
	})
	LastBlockTime = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "dex_indexer_last_block_time_seconds",
		Help: "Unix timestamp of the most recently processed block.",
	})
	ReorgDepth = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "dex_indexer_reorg_depth",
		Help: "Depth of the most recent reorg unwind (blocks).",
	})
	Pairs = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "dex_indexer_pairs",
		Help: "Number of tracked pairs.",
	})
	SwapsTotal = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "dex_indexer_swaps_total",
		Help: "Number of swap events ingested since startup.",
	})
	LiquidityTotal = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "dex_indexer_liquidity_events_total",
		Help: "Number of mint/burn events ingested since startup.",
	})
	TickDuration = prometheus.NewHistogram(prometheus.HistogramOpts{
		Name:    "dex_indexer_tick_seconds",
		Help:    "Wall-clock duration of one indexer tick.",
		Buckets: prometheus.DefBuckets,
	})
)

func MustRegister() {
	prometheus.MustRegister(ChainHead, ProcessedHeight, LastBlockTime, ReorgDepth,
		Pairs, SwapsTotal, LiquidityTotal, TickDuration)
}

// Serve starts the /metrics endpoint and blocks. Call in a goroutine.
//
// We expose two health checks:
//   - /healthz: liveness — process is up. Always 200 if the HTTP server is
//     reachable, so kubelet only restarts on hard process death.
//   - /readyz: readiness — last block was processed within `maxLagSec` seconds.
//     If the indexer is silently stuck (e.g. EVM RPC has gone away) the lag
//     gauge will keep increasing and we'll start failing readiness so traffic
//     is routed to a healthy replica or alerts fire.
func Serve(addr string) error {
	return ServeWithReadiness(addr, 60)
}

// ServeWithReadiness lets the caller tune the staleness threshold (seconds)
// before /readyz starts returning 503. Use 0 to disable the lag check (only
// recommended for local dev).
func ServeWithReadiness(addr string, maxLagSec int) error {
	mux := http.NewServeMux()
	mux.Handle("/metrics", promhttp.Handler())
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	mux.HandleFunc("/readyz", func(w http.ResponseWriter, r *http.Request) {
		var ok = true
		var lag = -1.0
		// LastBlockTime is a unix-second gauge written every successful tick.
		// We read it via the prometheus internal channel by collecting once.
		ch := make(chan prometheus.Metric, 1)
		LastBlockTime.Collect(ch)
		select {
		case m := <-ch:
			var pb dto.Metric
			if err := m.Write(&pb); err == nil && pb.Gauge != nil && pb.Gauge.Value != nil {
				lag = float64(time.Now().Unix()) - *pb.Gauge.Value
				if maxLagSec > 0 && lag > float64(maxLagSec) {
					ok = false
				}
			}
		default:
		}
		w.Header().Set("content-type", "application/json")
		if !ok {
			w.WriteHeader(http.StatusServiceUnavailable)
		}
		fmt.Fprintf(w, `{"ok":%v,"lag_sec":%.1f}`, ok, lag)
	})
	srv := &http.Server{Addr: addr, Handler: mux}
	return srv.ListenAndServe()
}
