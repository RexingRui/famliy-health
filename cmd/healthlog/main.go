package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rexingrui/famliy-health/internal/config"
	"github.com/rexingrui/famliy-health/internal/handler"
	"github.com/rexingrui/famliy-health/internal/httpx"
	"github.com/rexingrui/famliy-health/internal/report"
	"github.com/rexingrui/famliy-health/internal/store"
	"github.com/rexingrui/famliy-health/web"
)

const usage = `usage: healthlog <command>

commands:
  serve         run migrations, then start the HTTP server
  migrate       apply database migrations and exit
  user create   create a login account (not implemented yet)
`

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

	if len(os.Args) < 2 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	var err error
	switch os.Args[1] {
	case "serve":
		err = serve(ctx)
	case "migrate":
		err = migrate(ctx)
	case "user":
		err = errors.New("user create: not implemented yet")
	default:
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	if err != nil {
		slog.Error("command failed", "command", os.Args[1], "err", err)
		os.Exit(1)
	}
}

func migrate(ctx context.Context) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	pool, err := store.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	return store.Migrate(ctx, pool)
}

func serve(ctx context.Context) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	pool, err := store.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := store.Migrate(ctx, pool); err != nil {
		return err
	}

	gotenberg := &report.Gotenberg{BaseURL: cfg.GotenbergURL, Client: &http.Client{Timeout: 5 * time.Second}}
	h := handler.New(map[string]handler.Checker{
		"database":  pool,
		"gotenberg": handler.CheckerFunc(gotenberg.Health),
	})

	srv := &http.Server{
		Addr: cfg.HTTPAddr,
		Handler: httpx.NewRouter(httpx.Options{
			Server:        h,
			Web:           web.Dist(),
			PublicBaseURL: cfg.PublicBaseURL,
		}),
		ReadHeaderTimeout: 10 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		slog.Info("http server listening", "addr", cfg.HTTPAddr)
		errCh <- srv.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	slog.Info("shutting down")
	return srv.Shutdown(shutdownCtx)
}
