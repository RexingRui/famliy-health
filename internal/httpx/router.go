// Package httpx wires the chi router, middleware, the generated API and the SPA.
// (Named httpx rather than http to avoid shadowing net/http.)
package httpx

import (
	"io/fs"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/rexingrui/famliy-health/internal/api"
)

type Options struct {
	Server            api.StrictServerInterface
	StrictMiddlewares []api.StrictMiddlewareFunc
	Web               fs.FS
	PublicBaseURL     string
	// BasePath ("" or "/health") prefixes every route, including /healthz and the SPA.
	BasePath string
}

func NewRouter(opts Options) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(requestLogger)
	r.Use(middleware.Recoverer)
	r.Use(originCheck(opts.PublicBaseURL))
	r.Use(maxBody)

	strict := api.NewStrictHandlerWithOptions(opts.Server, opts.StrictMiddlewares, api.StrictHTTPServerOptions{
		RequestErrorHandlerFunc:  requestErrorHandler,
		ResponseErrorHandlerFunc: responseErrorHandler,
	})
	api.HandlerWithOptions(strict, api.ChiServerOptions{
		BaseRouter:       r,
		ErrorHandlerFunc: requestErrorHandler,
	})

	spa := spaHandler(opts.Web)
	r.NotFound(spa)
	r.MethodNotAllowed(func(w http.ResponseWriter, _ *http.Request) {
		WriteError(w, http.StatusMethodNotAllowed, "method_not_allowed", "不支持的请求方法", nil)
	})
	return withBasePath(opts.BasePath, r)
}

// withBasePath serves h under base, so the app can share a domain with another site
// (crab owns /api, /t and /r there). Routes inside h stay root-relative.
func withBasePath(base string, h http.Handler) http.Handler {
	if base == "" {
		return h
	}
	strip := http.StripPrefix(base, h)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == base:
			target := base + "/"
			if r.URL.RawQuery != "" {
				target += "?" + r.URL.RawQuery
			}
			http.Redirect(w, r, target, http.StatusPermanentRedirect)
		case strings.HasPrefix(r.URL.Path, base+"/"):
			strip.ServeHTTP(w, r)
		default:
			http.NotFound(w, r)
		}
	})
}
