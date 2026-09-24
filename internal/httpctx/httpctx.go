// Package httpctx carries per-request values between the router middleware and handlers.
package httpctx

import (
	"context"
	"net/http"
)

type requestKey struct{}

// WithRequest stores the request so strict handlers can use net/http helpers that need it
// (http.ServeContent for Range requests, Set-Cookie).
func WithRequest(r *http.Request) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), requestKey{}, r))
}

func Request(ctx context.Context) *http.Request {
	r, _ := ctx.Value(requestKey{}).(*http.Request)
	return r
}

// LogFields is filled in by inner layers and read by the access log after the handler returns.
// Context values flow inwards only, so the logger places a mutable holder up front.
type LogFields struct {
	AccountID string
}

type logKey struct{}

func WithLogFields(ctx context.Context) (context.Context, *LogFields) {
	f := &LogFields{}
	return context.WithValue(ctx, logKey{}, f), f
}

func SetAccount(ctx context.Context, id string) {
	if f, ok := ctx.Value(logKey{}).(*LogFields); ok {
		f.AccountID = id
	}
}
