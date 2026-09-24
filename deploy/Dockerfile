# Build from the repository root: docker build -f deploy/Dockerfile .

FROM node:22-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /src/web/dist ./web/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/healthlog ./cmd/healthlog

FROM alpine:3.22
RUN apk add --no-cache ffmpeg ca-certificates tzdata \
    && adduser -D -H -u 10001 app \
    && mkdir -p /data/storage && chown app /data/storage
ENV TZ=Asia/Shanghai \
    HTTP_ADDR=:8080 \
    STORAGE_DIR=/data/storage
COPY --from=build /out/healthlog /usr/local/bin/healthlog
USER app
EXPOSE 8080
ENTRYPOINT ["healthlog"]
CMD ["serve"]
