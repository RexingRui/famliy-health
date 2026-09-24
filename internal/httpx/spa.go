package httpx

import (
	"errors"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

// spaHandler serves the built frontend. Unknown paths fall back to index.html so
// client-side routes (/episodes/:id, ...) work on reload.
func spaHandler(dist fs.FS) http.HandlerFunc {
	files := http.FileServerFS(dist)
	return func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/api" {
			WriteError(w, http.StatusNotFound, "not_found", "接口不存在", nil)
			return
		}
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if name != "" {
			if _, err := fs.Stat(dist, name); err == nil {
				if strings.HasPrefix(name, "assets/") {
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				}
				files.ServeHTTP(w, r)
				return
			} else if !errors.Is(err, fs.ErrNotExist) {
				WriteError(w, http.StatusInternalServerError, "internal", "服务器出错了，请稍后再试", nil)
				return
			}
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFileFS(w, r, dist, "index.html")
	}
}
