// Package web embeds the built frontend (web/dist) into the Go binary.
// Run `npm run build` (or `make web-stub` for backend-only work) before compiling.
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

func Dist() fs.FS {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		panic(err)
	}
	return sub
}
