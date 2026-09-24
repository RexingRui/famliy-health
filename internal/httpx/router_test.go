package httpx

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/rexingrui/famliy-health/internal/api"
	"github.com/rexingrui/famliy-health/internal/handler"
)

func newTestRouter(checks map[string]handler.Checker) http.Handler {
	return NewRouter(Options{
		Server: handler.New(handler.Options{Checks: checks}),
		Web: fstest.MapFS{
			"index.html":    {Data: []byte("<html>app</html>")},
			"assets/app.js": {Data: []byte("console.log(1)")},
		},
		PublicBaseURL: "https://health.example.com",
	})
}

func do(h http.Handler, method, path string, header map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, nil)
	for k, v := range header {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestSPAFallback(t *testing.T) {
	h := newTestRouter(nil)

	rec := do(h, http.MethodGet, "/episodes/123", nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "app") {
		t.Fatalf("client route: got %d %q", rec.Code, rec.Body.String())
	}

	rec = do(h, http.MethodGet, "/assets/app.js", nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Header().Get("Cache-Control"), "immutable") {
		t.Fatalf("asset: got %d cache=%q", rec.Code, rec.Header().Get("Cache-Control"))
	}
}

func TestUnknownAPIReturnsJSONError(t *testing.T) {
	rec := do(newTestRouter(nil), http.MethodGet, "/api/nope", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d", rec.Code)
	}
	var body api.Error
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || body.Error.Code != "not_found" {
		t.Fatalf("body = %q, err = %v", rec.Body.String(), err)
	}
}

func TestOriginCheck(t *testing.T) {
	h := newTestRouter(nil)
	cases := []struct {
		name   string
		origin string
		want   int
	}{
		{"missing origin", "", http.StatusForbidden},
		{"foreign origin", "https://evil.example.com", http.StatusForbidden},
		{"public origin", "https://health.example.com", http.StatusNotFound},
		{"same host", "http://example.com", http.StatusNotFound},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			header := map[string]string{}
			if tc.origin != "" {
				header["Origin"] = tc.origin
			}
			if rec := do(h, http.MethodPost, "/api/anything", header); rec.Code != tc.want {
				t.Fatalf("status = %d, want %d", rec.Code, tc.want)
			}
		})
	}
}

func TestHealthz(t *testing.T) {
	ok := handler.CheckerFunc(func(context.Context) error { return nil })
	down := handler.CheckerFunc(func(context.Context) error { return errors.New("down") })

	if rec := do(newTestRouter(map[string]handler.Checker{"database": ok}), http.MethodGet, "/healthz", nil); rec.Code != http.StatusOK {
		t.Fatalf("healthy: status = %d", rec.Code)
	}

	rec := do(newTestRouter(map[string]handler.Checker{"database": ok, "gotenberg": down}), http.MethodGet, "/healthz", nil)
	var body api.Health
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusServiceUnavailable || body.Status != api.HealthStatusDegraded || body.Checks["gotenberg"] != "down" {
		t.Fatalf("degraded: status = %d body = %+v", rec.Code, body)
	}
}
