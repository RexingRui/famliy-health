// Package handler implements the oapi-codegen strict server interface.
// Handlers only parse input and shape responses; business rules live in service.
package handler

import (
	"context"
	"time"

	"github.com/rexingrui/famliy-health/internal/api"
	"github.com/rexingrui/famliy-health/internal/service"
)

type Checker interface {
	Ping(ctx context.Context) error
}

type CheckerFunc func(ctx context.Context) error

func (f CheckerFunc) Ping(ctx context.Context) error { return f(ctx) }

type Handler struct {
	mapper
	svc          *service.Service
	checks       map[string]Checker
	cookieSecure bool
}

var _ api.StrictServerInterface = (*Handler)(nil)

type Options struct {
	Service *service.Service
	Checks  map[string]Checker
	// CookieSecure must be true behind HTTPS; plain-http local dev turns it off.
	CookieSecure bool
	// BasePath ("" or "/health") prefixes emitted URLs and scopes the session cookie.
	BasePath string
}

func New(o Options) *Handler {
	return &Handler{mapper: mapper{base: o.BasePath}, svc: o.Service, checks: o.Checks, cookieSecure: o.CookieSecure}
}

// cookiePath keeps the session cookie away from other apps on the same domain.
func (h *Handler) cookiePath() string {
	if h.base == "" {
		return "/"
	}
	return h.base + "/"
}

func (h *Handler) Healthz(ctx context.Context, _ api.HealthzRequestObject) (api.HealthzResponseObject, error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	res := api.Health{Status: api.HealthStatusOk, Checks: map[string]string{}}
	for name, c := range h.checks {
		if err := c.Ping(ctx); err != nil {
			res.Status = api.HealthStatusDegraded
			res.Checks[name] = err.Error()
			continue
		}
		res.Checks[name] = "ok"
	}
	if res.Status != api.HealthStatusOk {
		return api.Healthz503JSONResponse(res), nil
	}
	return api.Healthz200JSONResponse(res), nil
}
