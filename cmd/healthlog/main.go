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

	"github.com/rexingrui/famliy-health/internal/api"
	"github.com/rexingrui/famliy-health/internal/config"
	"github.com/rexingrui/famliy-health/internal/handler"
	"github.com/rexingrui/famliy-health/internal/httpx"
	"github.com/rexingrui/famliy-health/internal/jobs"
	"github.com/rexingrui/famliy-health/internal/report"
	"github.com/rexingrui/famliy-health/internal/service"
	"github.com/rexingrui/famliy-health/internal/storage"
	"github.com/rexingrui/famliy-health/internal/store"
	"github.com/rexingrui/famliy-health/web"
)

const usage = `usage: healthlog <command>

commands:
  serve                             run migrations, then start the HTTP server and job runner
  migrate                           apply database migrations and exit
  user create --username NAME       create a login account (password read from the terminal
              [--display-name N]    or, with --password-stdin, from standard input)
              [--family-name N]
  user passwd --username NAME       reset a password and sign out all its sessions
  purge-data --confirm              delete the family with all members, records and files
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
		err = userCommand(ctx, os.Args[2:])
	case "purge-data":
		err = purgeData(ctx, os.Args[2:])
	default:
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	if err != nil {
		slog.Error("command failed", "command", os.Args[1], "err", err)
		os.Exit(1)
	}
}

func openStore(ctx context.Context) (config.Config, *store.Store, error) {
	cfg, err := config.Load()
	if err != nil {
		return cfg, nil, err
	}
	pool, err := store.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return cfg, nil, err
	}
	if err := store.Migrate(ctx, pool); err != nil {
		pool.Close()
		return cfg, nil, err
	}
	return cfg, store.New(pool), nil
}

func migrate(ctx context.Context) error {
	_, st, err := openStore(ctx)
	if err != nil {
		return err
	}
	st.Pool.Close()
	return nil
}

func serve(ctx context.Context) error {
	cfg, st, err := openStore(ctx)
	if err != nil {
		return err
	}
	defer st.Pool.Close()

	files, err := storage.NewLocal(cfg.StorageDir)
	if err != nil {
		return err
	}
	runner := jobs.NewRunner(st)
	svc := service.New(st, files, runner.Wake)
	runner.Handle(jobs.KindTranscodeAudio, svc.TranscodeJob, svc.TranscodeFailed)
	runner.Handle(jobs.KindDeleteFiles, svc.DeleteFilesJob, nil)

	gotenberg := &report.Gotenberg{BaseURL: cfg.GotenbergURL, Client: &http.Client{Timeout: 90 * time.Second}}
	if signer, err := report.NewSigner(cfg.PrintTokenSecret); err != nil {
		slog.Warn("PDF export disabled", "reason", err.Error())
	} else {
		svc.SetReports(service.Reports{Signer: signer, Gotenberg: gotenberg, PrintBaseURL: cfg.PrintBaseURL})
	}

	healthGotenberg := &report.Gotenberg{BaseURL: cfg.GotenbergURL, Client: &http.Client{Timeout: 3 * time.Second}}
	h := handler.New(handler.Options{
		Service:      svc,
		CookieSecure: cfg.CookieSecure(),
		Checks: map[string]handler.Checker{
			"database":  st.Pool,
			"gotenberg": handler.CheckerFunc(healthGotenberg.Health),
		},
	})

	srv := &http.Server{
		Addr: cfg.HTTPAddr,
		Handler: httpx.NewRouter(httpx.Options{
			Server:            h,
			StrictMiddlewares: []api.StrictMiddlewareFunc{h.AuthMiddleware},
			Web:               web.Dist(),
			PublicBaseURL:     cfg.PublicBaseURL,
		}),
		ReadHeaderTimeout: 10 * time.Second,
	}

	bg, stopBg := context.WithCancel(context.Background())
	defer stopBg()
	runner.Start(bg)
	go housekeeping(bg, svc, st)

	errCh := make(chan error, 1)
	go func() {
		slog.Info("http server listening", "addr", cfg.HTTPAddr)
		errCh <- srv.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		stopBg()
		runner.Wait()
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
	}

	slog.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	err = srv.Shutdown(shutdownCtx)
	stopBg()
	runner.Wait()
	return err
}

// housekeeping removes expired sessions and old finished jobs once an hour.
func housekeeping(ctx context.Context, svc *service.Service, st *store.Store) {
	t := time.NewTicker(time.Hour)
	defer t.Stop()
	for {
		if n, err := svc.PurgeExpiredSessions(ctx); err != nil && ctx.Err() == nil {
			slog.Error("purge sessions", "err", err)
		} else if n > 0 {
			slog.Info("purged expired sessions", "count", n)
		}
		if _, err := st.DeleteFinishedJobs(ctx, time.Now().AddDate(0, 0, -30)); err != nil && ctx.Err() == nil {
			slog.Error("purge jobs", "err", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}
