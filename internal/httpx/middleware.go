package httpx

import (
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5/middleware"

	"github.com/rexingrui/famliy-health/internal/httpctx"
)

// requestLogger logs method, path, status, latency and the account. Never log bodies or
// query strings: they hold health data and print tokens.
func requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, fields := httpctx.WithLogFields(r.Context())
		r = httpctx.WithRequest(r.WithContext(ctx))
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		start := time.Now()
		next.ServeHTTP(ww, r)
		slog.InfoContext(r.Context(), "http request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", ww.Status(),
			"bytes", ww.BytesWritten(),
			"duration_ms", time.Since(start).Milliseconds(),
			"request_id", middleware.GetReqID(r.Context()),
			"account", fields.AccountID,
		)
	})
}

// originCheck rejects state-changing requests whose Origin is not this site (CSRF defence
// on top of SameSite=Lax cookies).
func originCheck(publicBaseURL string) func(http.Handler) http.Handler {
	allowed := ""
	if u, err := url.Parse(publicBaseURL); err == nil && u.Host != "" {
		allowed = u.Scheme + "://" + u.Host
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet, http.MethodHead, http.MethodOptions:
				next.ServeHTTP(w, r)
				return
			}
			origin := r.Header.Get("Origin")
			u, err := url.Parse(origin)
			if origin == "" || err != nil || (origin != allowed && u.Host != r.Host) {
				WriteError(w, http.StatusForbidden, "forbidden_origin", "请求来源不被允许", nil)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// maxBody caps request bodies; uploads get more room than JSON.
func maxBody(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		limit := int64(1 << 20)
		if r.Method == http.MethodPut && strings.HasPrefix(r.URL.Path, "/api/attachments/") {
			limit = 25 << 20
		}
		r.Body = http.MaxBytesReader(w, r.Body, limit)
		next.ServeHTTP(w, r)
	})
}
