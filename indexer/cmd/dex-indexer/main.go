package main

import (
	"context"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/rs/zerolog"

	"energychain/dex/indexer/internal/config"
	"energychain/dex/indexer/internal/cosmosrunner"
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

	log.Info().
		Bool("evm", cfg.EvmEnabled).
		Bool("cosmos", cfg.CosmosEnabled).
		Msg("dex-indexer starting")

	var wg sync.WaitGroup
	failed := false

	if cfg.EvmEnabled {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r := runner.New(cfg, store, log)
			if err := r.Run(ctx); err != nil && err != context.Canceled {
				log.Error().Err(err).Msg("evm runner exited")
				failed = true
				cancel()
			}
		}()
	}
	if cfg.CosmosEnabled {
		wg.Add(1)
		go func() {
			defer wg.Done()
			cr := cosmosrunner.New(cfg, store, log)
			if err := cr.Run(ctx); err != nil && err != context.Canceled {
				log.Error().Err(err).Msg("cosmos runner exited")
				failed = true
				cancel()
			}
		}()
	}

	wg.Wait()
	if failed {
		os.Exit(1)
	}
}
