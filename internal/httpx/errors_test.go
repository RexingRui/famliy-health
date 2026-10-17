package httpx

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestResponseErrorHandlerSkipsCancelledRequests(t *testing.T) {
	var logs bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	req := httptest.NewRequest(http.MethodGet, "/api/home", nil).WithContext(ctx)
	responseErrorHandler(httptest.NewRecorder(), req, fmt.Errorf("query home: %w", context.Canceled))
	if logs.Len() != 0 {
		t.Fatalf("logged a request the client cancelled: %s", logs.String())
	}

	// A cancellation the client did not cause is still a server fault.
	rec := httptest.NewRecorder()
	responseErrorHandler(rec, httptest.NewRequest(http.MethodGet, "/api/home", nil), context.Canceled)
	if rec.Code != http.StatusInternalServerError || logs.Len() == 0 {
		t.Fatalf("status %d, logs %q", rec.Code, logs.String())
	}

	logs.Reset()
	rec = httptest.NewRecorder()
	responseErrorHandler(rec, httptest.NewRequest(http.MethodGet, "/api/home", nil), errors.New("boom"))
	if rec.Code != http.StatusInternalServerError || logs.Len() == 0 {
		t.Fatalf("status %d, logs %q", rec.Code, logs.String())
	}
}
