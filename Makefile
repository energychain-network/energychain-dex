SHELL := /bin/bash
COMPOSE := docker compose
DEX_DIR := $(CURDIR)
DEPLOY := $(DEX_DIR)/deploy
CONTRACTS := $(DEX_DIR)/../contracts

.PHONY: help env up down restart logs ps migrate seed e2e simulate sdk-build sdk-check api-check indexer-check

help:
	@echo "Targets:"
	@echo "  make env          # copy deploy/.env.example -> deploy/.env if missing"
	@echo "  make migrate      # run schema migrations"
	@echo "  make up           # start the full DEX stack (postgres/redis/indexer/api/web/...)"
	@echo "  make down         # stop and remove containers"
	@echo "  make restart      # rebuild and restart api/web/indexer in place"
	@echo "  make logs         # tail indexer + api logs"
	@echo "  make simulate     # run the existing trade-simulator against the deployed router"
	@echo "  make e2e          # smoke check: overview, pairs, candles, swaps endpoints"
	@echo "  make sdk-build    # build @energychain/dex-sdk"

env:
	@if [ ! -f $(DEPLOY)/.env ]; then cp $(DEPLOY)/.env.example $(DEPLOY)/.env && echo "wrote deploy/.env"; \
	  else echo "deploy/.env already exists"; fi

migrate: env
	cd $(DEPLOY) && $(COMPOSE) --profile migrate run --rm migrate

up: env
	cd $(DEPLOY) && $(COMPOSE) up -d --build

down:
	cd $(DEPLOY) && $(COMPOSE) down

restart:
	cd $(DEPLOY) && $(COMPOSE) build api web indexer && $(COMPOSE) up -d --no-deps api web indexer

ps:
	cd $(DEPLOY) && $(COMPOSE) ps

logs:
	cd $(DEPLOY) && $(COMPOSE) logs -f --tail=200 indexer api

simulate:
	cd $(CONTRACTS) && npx hardhat run scripts/simulate_trades.ts --network energychain

# Quick E2E smoke that hits the most important read endpoints. Tolerates an
# empty database (no pairs yet) and only fails if the API itself is unreachable.
e2e:
	@set -e; \
	BASE=$${BASE:-http://localhost:8081/api/v1}; \
	echo "GET $$BASE/overview"; curl -sf $$BASE/overview | head -c 400; echo; \
	echo "GET $$BASE/pairs?limit=3"; curl -sf "$$BASE/pairs?limit=3" | head -c 400; echo; \
	PAIR=$$(curl -sf "$$BASE/pairs?limit=1" | python3 -c "import sys,json;d=json.load(sys.stdin)['items'];print(d[0]['address'] if d else '')"); \
	if [ -n "$$PAIR" ]; then \
	  echo "Top pair: $$PAIR"; \
	  echo "GET $$BASE/pairs/$$PAIR/candles?granularity=1m&limit=5"; curl -sf "$$BASE/pairs/$$PAIR/candles?granularity=1m&limit=5" | head -c 400; echo; \
	  echo "GET $$BASE/pairs/$$PAIR/swaps?limit=5";  curl -sf "$$BASE/pairs/$$PAIR/swaps?limit=5"  | head -c 400; echo; \
	  echo "GET $$BASE/pairs/$$PAIR/liquidity?limit=5"; curl -sf "$$BASE/pairs/$$PAIR/liquidity?limit=5" | head -c 400; echo; \
	else \
	  echo "(no pairs in database yet — skipping pair-scoped checks)"; \
	fi; \
	echo "GET $$BASE/tokens?limit=3";  curl -sf "$$BASE/tokens?limit=3"  | head -c 400; echo; \
	echo "GET $$BASE/swaps?limit=3";   curl -sf "$$BASE/swaps?limit=3"   | head -c 400; echo; \
	echo "GET $$BASE/search?q=ECY";    curl -sf "$$BASE/search?q=ECY"    | head -c 400; echo; \
	echo OK

sdk-build:
	cd sdk && npm install --no-audit --no-fund && npm run build

sdk-check:
	cd sdk && npm install --no-audit --no-fund && npm run check

api-check:
	cd api && go build ./...

indexer-check:
	cd indexer && go build ./...
