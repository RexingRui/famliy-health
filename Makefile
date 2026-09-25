SQLC_VERSION := v1.31.1

ifneq (,$(wildcard .env))
include .env
export $(shell sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' .env)
endif

.PHONY: help gen gen-sql gen-api gen-web dev dev-deps dev-down dev-api dev-web dev-mock \
	test test-go test-web test-integration user-create lint build web-build web-stub \
	docker-init deploy backup

help:
	@echo "make gen              regenerate sqlc, oapi-codegen and openapi-typescript output"
	@echo "make dev              start postgres + gotenberg, backend (air) and frontend (vite)"
	@echo "make user-create USERNAME=me  create a login account in the dev database"
	@echo "make test             unit tests (go + vitest)"
	@echo "make test-integration API tests against the dev PostgreSQL (TEST_DATABASE_URL)"
	@echo "make lint             go vet + gofmt + oxlint + tsc"
	@echo "make build            build frontend, then bin/healthlog with it embedded"
	@echo "sudo make docker-init create data dirs owned by the container user (server)"
	@echo "make deploy           pull, build, replace, self-check, roll back on failure (server)"
	@echo "make backup           pg_dump + attachment mirror (server)"

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

# Frontend only, against the in-browser mock backend (account demo / demo).
dev-mock:
	cd web && npm run dev:mock

user-create: web-stub
	@test -n "$(USERNAME)" || { echo "usage: make user-create USERNAME=me"; exit 1; }
	go run ./cmd/healthlog user create --username $(USERNAME)

## Checks
test: test-go test-web

test-go: web-stub
	go test ./...

test-web:
	cd web && npm test

test-integration: web-stub
	@test -n "$(TEST_DATABASE_URL)" || { echo "set TEST_DATABASE_URL (see .env.example)"; exit 1; }
	go test -count=1 ./internal/apitest/...

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

## Server
docker-init:
	mkdir -p data/storage data/postgres backup
	chown -R 10001:10001 data/storage

deploy:
	./scripts/deploy.sh

backup:
	./scripts/backup.sh
