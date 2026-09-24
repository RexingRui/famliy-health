SQLC_VERSION := v1.31.1

ifneq (,$(wildcard .env))
include .env
export $(shell sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' .env)
endif

.PHONY: help gen gen-sql gen-api gen-web dev dev-deps dev-down dev-api dev-web \
	test test-go test-web lint build web-build web-stub docker-build

help:
	@echo "make gen         regenerate sqlc, oapi-codegen and openapi-typescript output"
	@echo "make dev         start postgres + gotenberg, backend (air) and frontend (vite)"
	@echo "make test        go test + vitest"
	@echo "make lint        go vet + gofmt + oxlint + tsc"
	@echo "make build       build frontend, then bin/healthlog with it embedded"
	@echo "make docker-build build the production image"

## Code generation — generated files are committed; CI checks they are up to date.
gen: gen-sql gen-api gen-web

gen-sql:
	@command -v sqlc >/dev/null || { echo "sqlc not found: go install github.com/sqlc-dev/sqlc/cmd/sqlc@$(SQLC_VERSION)"; exit 1; }
	sqlc generate

gen-api:
	go tool oapi-codegen -config api/oapi-codegen.yaml api/openapi.yaml

gen-web:
	cd web && npm run gen:api

## Local development
dev: dev-deps
	$(MAKE) -j2 dev-api dev-web

dev-deps:
	docker compose -f deploy/docker-compose.dev.yml up -d

dev-down:
	docker compose -f deploy/docker-compose.dev.yml down

dev-api: web-stub
	go tool air

dev-web:
	cd web && npm run dev

## Checks
test: test-go test-web

test-go: web-stub
	go test ./...

test-web:
	cd web && npm test

lint: web-stub
	go vet ./...
	@test -z "$$(gofmt -l cmd internal db web/embed.go)" || { gofmt -l cmd internal db web/embed.go; exit 1; }
	cd web && npm run lint && npm run typecheck

## Build
web-build:
	cd web && npm run build

# go:embed needs web/dist to exist; backend-only work can use a placeholder page.
web-stub:
	@test -f web/dist/index.html || { mkdir -p web/dist && echo '<!doctype html><title>healthlog</title><p>frontend not built: run make web-build</p>' > web/dist/index.html; }

build: web-build
	CGO_ENABLED=0 go build -trimpath -o bin/healthlog ./cmd/healthlog

docker-build:
	docker build -f deploy/Dockerfile -t healthlog:latest .
