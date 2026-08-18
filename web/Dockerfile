FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN apk add --no-cache libc6-compat \
 && (npm config set fetch-retries 5 && npm install --no-audit --no-fund --legacy-peer-deps)

FROM node:20-alpine AS builder
WORKDIR /app
ARG NEXT_PUBLIC_DEX_API_BASE
ARG NEXT_PUBLIC_DEX_WS
ARG NEXT_PUBLIC_DEX_CHAIN_ID
ARG NEXT_PUBLIC_DEX_RPC
ARG NEXT_PUBLIC_WC_PROJECT_ID
ARG NEXT_PUBLIC_DEX_FACTORY
ARG NEXT_PUBLIC_DEX_ROUTER
ARG NEXT_PUBLIC_DEX_WECY
ARG NEXT_PUBLIC_DEX_COSMOS_CHAIN_ID
ARG NEXT_PUBLIC_DEX_COSMOS_RPC
ARG NEXT_PUBLIC_DEX_COSMOS_REST
ARG NEXT_PUBLIC_BECH32_PREFIX
ARG NEXT_PUBLIC_NATIVE_DENOM
ARG NEXT_PUBLIC_NATIVE_DISPLAY
ARG NEXT_PUBLIC_NATIVE_DECIMALS
ARG NEXT_PUBLIC_GAS_PRICE
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_DEX_API_BASE=${NEXT_PUBLIC_DEX_API_BASE} \
    NEXT_PUBLIC_DEX_WS=${NEXT_PUBLIC_DEX_WS} \
    NEXT_PUBLIC_DEX_CHAIN_ID=${NEXT_PUBLIC_DEX_CHAIN_ID} \
    NEXT_PUBLIC_DEX_RPC=${NEXT_PUBLIC_DEX_RPC} \
    NEXT_PUBLIC_WC_PROJECT_ID=${NEXT_PUBLIC_WC_PROJECT_ID} \
    NEXT_PUBLIC_DEX_FACTORY=${NEXT_PUBLIC_DEX_FACTORY} \
    NEXT_PUBLIC_DEX_ROUTER=${NEXT_PUBLIC_DEX_ROUTER} \
    NEXT_PUBLIC_DEX_WECY=${NEXT_PUBLIC_DEX_WECY} \
    NEXT_PUBLIC_DEX_COSMOS_CHAIN_ID=${NEXT_PUBLIC_DEX_COSMOS_CHAIN_ID} \
    NEXT_PUBLIC_DEX_COSMOS_RPC=${NEXT_PUBLIC_DEX_COSMOS_RPC} \
    NEXT_PUBLIC_DEX_COSMOS_REST=${NEXT_PUBLIC_DEX_COSMOS_REST} \
    NEXT_PUBLIC_BECH32_PREFIX=${NEXT_PUBLIC_BECH32_PREFIX} \
    NEXT_PUBLIC_NATIVE_DENOM=${NEXT_PUBLIC_NATIVE_DENOM} \
    NEXT_PUBLIC_NATIVE_DISPLAY=${NEXT_PUBLIC_NATIVE_DISPLAY} \
    NEXT_PUBLIC_NATIVE_DECIMALS=${NEXT_PUBLIC_NATIVE_DECIMALS} \
    NEXT_PUBLIC_GAS_PRICE=${NEXT_PUBLIC_GAS_PRICE}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
# Serve with `next start` from the full .next output. The standalone server
# produced inconsistent per-route 404s for this app on this host, so we use the
# canonical server which reliably serves every compiled route.
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/next.config.* ./
USER nextjs
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-p", "3000"]
