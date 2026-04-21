package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	ChainID       int
	PGDSN         string
	RedisAddr     string
	RedisDB       int
	EvmRPC        string
	EvmWS         string // optional; falls back to polling if empty
	Factory       string // 0x-prefixed hex
	Router        string
	WECY          string // wrapped native token, used as base for USD pricing
	USDTAnchor    string // optional; pair token used to translate WECY -> USD
	// StableTokens is the full list of stablecoins used to derive WECY-USD
	// price. The legacy USDTAnchor is auto-included if non-empty. We aggregate
	// across all stable pools rather than trusting a single one so a drained
	// or manipulated USDT pool can't poison every chart on the site.
	StableTokens []string
	// PriceTWAPDeviationBps is the maximum deviation (in bps) the spot price
	// may have from the trailing 30-minute TWAP before we fall back to TWAP.
	// 0 = disabled. 2000 = 20%.
	PriceTWAPDeviationBps int
	StartHeight   int64
	BatchSize     int
	Confirmations int
	TickInterval  time.Duration
	PromListen    string
	LogLevel      string
	// VerifiedTokens is a comma-separated list of token addresses that should
	// be promoted to trust_score=2 (curated/verified). Used to mark the
	// canonical USDT/USDC/etc. so the swap UI's "verified only" filter has
	// something to display from day one. Wrapped-native + the USDT anchor
	// are auto-promoted; everything else needs to be on this list.
	VerifiedTokens []string
	// LogoBaseURL is an optional CDN/static-site prefix for token logos. The
	// indexer assembles `${LogoBaseURL}/${address}.png` and stores it in the
	// tokens.logo_url column so the frontend can render real icons instead
	// of hash-coloured placeholders.
	LogoBaseURL string
}

func Load() (*Config, error) {
	c := &Config{
		ChainID:       envInt("DEX_CHAIN_ID", 9001),
		PGDSN:         env("DEX_PG_DSN", "postgres://dex:dex@localhost:55432/energy_dex?sslmode=disable"),
		RedisAddr:     env("DEX_REDIS_ADDR", "localhost:56379"),
		RedisDB:       envInt("DEX_REDIS_DB", 0),
		EvmRPC:        env("DEX_EVM_RPC", "http://localhost:8545"),
		EvmWS:         env("DEX_EVM_WS", ""),
		Factory:       strings.ToLower(env("DEX_FACTORY", "")),
		Router:        strings.ToLower(env("DEX_ROUTER", "")),
		WECY:          strings.ToLower(env("DEX_WECY", "")),
		USDTAnchor:    strings.ToLower(env("DEX_USDT", "")),
		StableTokens:  splitCSV(strings.ToLower(env("DEX_STABLE_TOKENS", ""))),
		PriceTWAPDeviationBps: envInt("DEX_PRICE_TWAP_DEVIATION_BPS", 2000),
		StartHeight:   int64(envInt("DEX_INDEXER_START_HEIGHT", 0)),
		BatchSize:     envInt("DEX_INDEXER_BATCH_SIZE", 200),
		Confirmations: envInt("DEX_INDEXER_CONFIRMATIONS", 2),
		TickInterval:  envDuration("DEX_INDEXER_TICK_INTERVAL", 2*time.Second),
		PromListen:    env("DEX_PROM_LISTEN", ":9100"),
		LogLevel:      env("LOG_LEVEL", "info"),
		VerifiedTokens: splitCSV(strings.ToLower(env("DEX_VERIFIED_TOKENS", ""))),
		LogoBaseURL:    strings.TrimRight(env("DEX_LOGO_BASE_URL", ""), "/"),
	}
	if c.Factory == "" {
		return nil, fmt.Errorf("DEX_FACTORY required")
	}
	return c, nil
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
func envInt(k string, def int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}
func splitCSV(s string) []string {
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func envDuration(k string, def time.Duration) time.Duration {
	if v := os.Getenv(k); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}
