package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rs/zerolog"

	"energychain/dex/indexer/internal/config"
	"energychain/dex/indexer/internal/metrics"
	"energychain/dex/indexer/internal/runner"
	"energychain/dex/indexer/internal/storage"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		panic(err)
	}
	zerolog.TimeFieldFormat = time.RFC3339Nano
	logLevel, _ := zerolog.ParseLevel(cfg.LogLevel)
	if logLevel == zerolog.NoLevel {
		logLevel = zerolog.InfoLevel
	}
	log := zerolog.New(os.Stdout).Level(logLevel).With().
		Timestamp().Str("service", "dex-indexer").Logger()

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	store, err := storage.Open(ctx, cfg.PGDSN)
	if err != nil {
		log.Fatal().Err(err).Msg("open postgres")
	}
	defer store.Close()

	metrics.MustRegister()
	go func() {
		if err := metrics.Serve(cfg.PromListen); err != nil {
			log.Error().Err(err).Msg("metrics http")
		}
	}()

	r := runner.New(cfg, store, log)
	log.Info().Msg("dex-indexer starting")
	if err := r.Run(ctx); err != nil && err != context.Canceled {
		log.Error().Err(err).Msg("runner exited")
		os.Exit(1)
	}
}
