package httpx

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/rexingrui/famliy-health/internal/api"
	"github.com/rexingrui/famliy-health/internal/errs"
)

// WriteError writes the unified error body: {"error":{"code","message","fields"}}.
func WriteError(w http.ResponseWriter, status int, code, message string, fields map[string]string) {
	var body api.Error
	body.Error.Code = code
	body.Error.Message = message
	if len(fields) > 0 {
		body.Error.Fields = &fields
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		slog.Error("write error response", "err", err)
	}
}

func requestErrorHandler(w http.ResponseWriter, _ *http.Request, err error) {
	WriteError(w, http.StatusBadRequest, "bad_request", "请求参数不正确："+err.Error(), nil)
}

// responseErrorHandler maps business errors to their status; anything else is a 500 whose
// details only go to the log.
func responseErrorHandler(w http.ResponseWriter, r *http.Request, err error) {
	// The client went away (closed the page, or a newer query replaced this one): nobody reads
	// the response and it is not a server fault, so don't log it as one.
	if errors.Is(err, context.Canceled) && r.Context().Err() != nil {
		return
	}
	if e, ok := errs.As(err); ok {
		if e.Status >= 500 || e.Err != nil {
			slog.ErrorContext(r.Context(), "request failed", "path", r.URL.Path, "code", e.Code, "err", err)
		}
		WriteError(w, e.Status, e.Code, e.Message, e.Fields)
		return
	}
	slog.ErrorContext(r.Context(), "handler error", "path", r.URL.Path, "err", err)
	WriteError(w, http.StatusInternalServerError, "internal", "服务器出错了，请稍后再试", nil)
}
