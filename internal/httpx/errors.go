package httpx

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/rexingrui/famliy-health/internal/api"
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
	WriteError(w, http.StatusBadRequest, "bad_request", err.Error(), nil)
}

func responseErrorHandler(w http.ResponseWriter, r *http.Request, err error) {
	slog.ErrorContext(r.Context(), "handler error", "path", r.URL.Path, "err", err)
	WriteError(w, http.StatusInternalServerError, "internal", "服务器出错了，请稍后再试", nil)
}
