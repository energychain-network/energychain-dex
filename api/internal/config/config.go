package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	ChainID      int
	PGDSN        string
	RedisAddr    string
	Listen       string
	PromListen   string
	CORSOrigins  []string
	RatePublic   int
	RatePartner  int
	EvmRPC       string
	Factory      string
	Router       string
	WECY         string
	LogLevel     string

	// Native Cosmos layer.
	CosmosEnabled  bool
	CosmosRPC      string // CometBFT RPC base
	CosmosREST     string // gRPC-gateway REST base
	CosmosChainID  string // e.g. energychain_9001-1
	Bech32Prefix   string // e.g. energy
	NativeDenom    string // e.g. uecy
	NativeDecimals int    // e.g. 18 (uecy -> ecy)
}

func Load() *Config {
	c := &Config{
		ChainID:     envInt("DEX_CHAIN_ID", 9001),
		PGDSN:       env("DEX_PG_DSN", "postgres://dex:dex@localhost:55432/energy_dex?sslmode=disable"),
		RedisAddr:   env("DEX_REDIS_ADDR", "localhost:56379"),
		Listen:      env("DEX_API_LISTEN", ":8081"),
		PromListen:  env("DEX_PROM_LISTEN", ":9101"),
		CORSOrigins: split(env("DEX_API_CORS_ORIGINS", "*"), ","),
		RatePublic:  envInt("DEX_API_RATE_PUBLIC", 60),
		RatePartner: envInt("DEX_API_RATE_PARTNER", 600),
		EvmRPC:      env("DEX_EVM_RPC", "http://localhost:8545"),
		Factory:     strings.ToLower(env("DEX_FACTORY", "")),
		Router:      strings.ToLower(env("DEX_ROUTER", "")),
		WECY:        strings.ToLower(env("DEX_WECY", "")),
		LogLevel:    env("LOG_LEVEL", "info"),

		CosmosEnabled:  envBool("DEX_COSMOS_ENABLED", false),
		CosmosRPC:      strings.TrimRight(env("DEX_COSMOS_RPC", "http://localhost:26657"), "/"),
		CosmosREST:     strings.TrimRight(env("DEX_COSMOS_REST", "http://localhost:1317"), "/"),
		CosmosChainID:  env("DEX_COSMOS_CHAIN_ID", "energychain_9001-1"),
		Bech32Prefix:   env("DEX_BECH32_PREFIX", "energy"),
		NativeDenom:    env("DEX_NATIVE_DENOM", "uecy"),
		NativeDecimals: envInt("DEX_NATIVE_DECIMALS", 18),
	}
	return c
}

func envBool(k string, def bool) bool {
	if v := os.Getenv(k); v != "" {
		switch strings.ToLower(v) {
		case "1", "true", "yes", "on":
			return true
		case "0", "false", "no", "off":
			return false
		}
	}
	return def
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

func split(s, sep string) []string {
	parts := strings.Split(s, sep)
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
