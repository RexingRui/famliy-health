# Build from the repository root: docker compose build app  (or docker build -f deploy/Dockerfile .)
#
# Mirrors default to ones reachable from Tencent Cloud in mainland China; overseas builds can
# pass --build-arg GOPROXY=https://proxy.golang.org,direct NPM_REGISTRY=https://registry.npmjs.org
# ALPINE_MIRROR= (empty keeps the default Alpine CDN).

FROM node:22-alpine AS web
ARG NPM_REGISTRY=https://registry.npmmirror.com
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --registry="$NPM_REGISTRY" --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM golang:1.26-alpine AS build
ARG GOPROXY=https://goproxy.cn,direct
ENV GOPROXY=${GOPROXY} CGO_ENABLED=0 GOFLAGS=-mod=readonly
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
COPY db ./db
COPY web/embed.go ./web/embed.go
COPY --from=web /src/web/dist ./web/dist
RUN go build -trimpath -ldflags="-s -w" -o /out/healthlog ./cmd/healthlog

FROM alpine:3.22
ARG ALPINE_MIRROR=https://mirrors.tencent.com
RUN if [ -n "$ALPINE_MIRROR" ]; then sed -i "s#https\?://dl-cdn.alpinelinux.org#${ALPINE_MIRROR}#g" /etc/apk/repositories; fi \
    && apk add --no-cache ffmpeg ca-certificates tzdata \
    && addgroup -g 10001 app && adduser -D -H -u 10001 -G app app \
    && mkdir -p /data/storage && chown app:app /data/storage
ENV TZ=Asia/Shanghai \
    HTTP_ADDR=:8080 \
    STORAGE_DIR=/data/storage
COPY --from=build /out/healthlog /usr/local/bin/healthlog
USER app
EXPOSE 8080
# 503 when PostgreSQL or Gotenberg is unreachable, so `docker compose ps` surfaces it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null 2>&1 || exit 1
ENTRYPOINT ["healthlog"]
CMD ["serve"]
