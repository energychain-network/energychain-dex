FROM golang:1.22-alpine AS build
WORKDIR /src
# proxy.golang.org is not reachable from this build network; use a mirror that
# is (same proxy the host's native toolchain uses) so module fetch succeeds.
ENV GOPROXY=https://goproxy.cn,direct GOSUMDB=off GOTOOLCHAIN=local
RUN apk add --no-cache git
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags='-s -w' -o /out/dex-indexer ./cmd/dex-indexer

FROM alpine:3.20
RUN adduser -D -u 10001 dex && apk add --no-cache ca-certificates
USER dex
COPY --from=build /out/dex-indexer /usr/local/bin/dex-indexer
EXPOSE 9100
ENTRYPOINT ["/usr/local/bin/dex-indexer"]
