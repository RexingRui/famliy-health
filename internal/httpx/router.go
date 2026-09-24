// Package httpx wires the chi router, middleware, the generated API and the SPA.
// (Named httpx rather than http to avoid shadowing net/http.)
package httpx

import (
	"io/fs"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/rexingrui/famliy-health/internal/api"
)

type Options struct {
	Server        api.StrictServerInterface
	Web           fs.FS
	PublicBaseURL string
}

func NewRouter(opts Options) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(requestLogger)
	r.Use(middleware.Recoverer)
	r.Use(originCheck(opts.PublicBaseURL))

	strict := api.NewStrictHandlerWithOptions(opts.Server, nil, api.StrictHTTPServerOptions{
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
	return r
}
