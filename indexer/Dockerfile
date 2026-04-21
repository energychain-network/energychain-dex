FROM golang:1.22-alpine AS build
WORKDIR /src
RUN apk add --no-cache git
COPY go.mod go.sum* ./
RUN go mod download || true
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags='-s -w' -o /out/dex-indexer ./cmd/dex-indexer

FROM alpine:3.20
RUN adduser -D -u 10001 dex && apk add --no-cache ca-certificates
USER dex
COPY --from=build /out/dex-indexer /usr/local/bin/dex-indexer
EXPOSE 9100
ENTRYPOINT ["/usr/local/bin/dex-indexer"]
