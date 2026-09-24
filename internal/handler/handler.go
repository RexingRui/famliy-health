// Package handler implements the oapi-codegen strict server interface.
// Handlers only parse input and shape responses; business rules live in service.
package handler

import (
	"context"
	"time"

	"github.com/rexingrui/famliy-health/internal/api"
)

type Checker interface {
	Ping(ctx context.Context) error
}

type CheckerFunc func(ctx context.Context) error

func (f CheckerFunc) Ping(ctx context.Context) error { return f(ctx) }

type Handler struct {
	checks map[string]Checker
}

var _ api.StrictServerInterface = (*Handler)(nil)

func New(checks map[string]Checker) *Handler {
	return &Handler{checks: checks}
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
