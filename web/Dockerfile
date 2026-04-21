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
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_DEX_API_BASE=${NEXT_PUBLIC_DEX_API_BASE} \
    NEXT_PUBLIC_DEX_WS=${NEXT_PUBLIC_DEX_WS} \
    NEXT_PUBLIC_DEX_CHAIN_ID=${NEXT_PUBLIC_DEX_CHAIN_ID} \
    NEXT_PUBLIC_DEX_RPC=${NEXT_PUBLIC_DEX_RPC} \
    NEXT_PUBLIC_WC_PROJECT_ID=${NEXT_PUBLIC_WC_PROJECT_ID} \
    NEXT_PUBLIC_DEX_FACTORY=${NEXT_PUBLIC_DEX_FACTORY} \
    NEXT_PUBLIC_DEX_ROUTER=${NEXT_PUBLIC_DEX_ROUTER} \
    NEXT_PUBLIC_DEX_WECY=${NEXT_PUBLIC_DEX_WECY}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
