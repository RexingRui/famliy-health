// Package jobs is a tiny durable queue on the jobs table: enqueue inside the caller's
// transaction, claim with FOR UPDATE SKIP LOCKED, retry with 1/5/30 minute backoff.
package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/rexingrui/famliy-health/internal/store"
	"github.com/rexingrui/famliy-health/internal/store/dbgen"
)

const (
	KindTranscodeAudio = "transcode_audio"
	KindDeleteFiles    = "delete_files"
)

type TranscodePayload struct {
	AttachmentID uuid.UUID `json:"attachmentId"`
}

type DeleteFilesPayload struct {
	Keys []string `json:"keys"`
}

// Enqueue adds a job using q, so it commits or rolls back with the caller's transaction.
func Enqueue(ctx context.Context, q *dbgen.Queries, kind string, payload any) error {
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	id, err := uuid.NewV7()
	if err != nil {
		return err
	}
	return q.EnqueueJob(ctx, dbgen.EnqueueJobParams{ID: id, Kind: kind, Payload: b, RunAfter: time.Now()})
}

// Handler runs one job. Returning Permanent(err) skips remaining retries.
type Handler func(ctx context.Context, payload []byte) error

// OnFailed is called once a job has exhausted its retries.
type OnFailed func(ctx context.Context, payload []byte, err error)

type permanentError struct{ err error }

func (p permanentError) Error() string { return p.err.Error() }
func (p permanentError) Unwrap() error { return p.err }

func Permanent(err error) error { return permanentError{err} }

var backoff = []time.Duration{time.Minute, 5 * time.Minute, 30 * time.Minute}

const maxAttempts = 3

type Runner struct {
	store    *store.Store
	handlers map[string]Handler
	failed   map[string]OnFailed
	poll     time.Duration
	wake     chan struct{}
	wg       sync.WaitGroup
}

func NewRunner(s *store.Store) *Runner {
	return &Runner{
		store:    s,
		handlers: map[string]Handler{},
		failed:   map[string]OnFailed{},
		poll:     5 * time.Second,
		wake:     make(chan struct{}, 1),
	}
}

func (r *Runner) Handle(kind string, h Handler, onFailed OnFailed) {
	r.handlers[kind] = h
	if onFailed != nil {
		r.failed[kind] = onFailed
	}
}

// Wake makes the runner poll immediately (call after committing an enqueue).
func (r *Runner) Wake() {
	select {
	case r.wake <- struct{}{}:
	default:
	}
}

// Start runs the poll loop until ctx is cancelled; Wait blocks until it has stopped.
func (r *Runner) Start(ctx context.Context) {
	if n, err := r.store.ResetRunningJobs(ctx); err != nil {
		slog.Error("reset running jobs", "err", err)
	} else if n > 0 {
		slog.Info("requeued jobs interrupted by restart", "count", n)
	}
	r.wg.Add(1)
	go func() {
		defer r.wg.Done()
		t := time.NewTicker(r.poll)
		defer t.Stop()
		for {
			for r.RunOnce(ctx) {
			}
			select {
			case <-ctx.Done():
				return
			case <-t.C:
			case <-r.wake:
			}
		}
	}()
}

func (r *Runner) Wait() { r.wg.Wait() }

// RunOnce claims and runs at most one due job; it reports whether one was run.
func (r *Runner) RunOnce(ctx context.Context) bool {
	if ctx.Err() != nil {
		return false
	}
	job, err := r.store.ClaimJob(ctx)
	if store.IsNotFound(err) {
		return false
	}
	if err != nil {
		slog.Error("claim job", "err", err)
		return false
	}

	h, ok := r.handlers[job.Kind]
	if !ok {
		err = Permanent(fmt.Errorf("no handler for job kind %q", job.Kind))
	} else {
		err = runSafely(ctx, h, job.Payload)
	}
	// Record the outcome even if shutdown cancelled ctx mid-job.
	done := context.WithoutCancel(ctx)
	if err == nil {
		if err := r.store.CompleteJob(done, job.ID); err != nil {
			slog.Error("complete job", "job", job.ID, "err", err)
		}
		return true
	}

	var perm permanentError
	msg := err.Error()
	if !errors.As(err, &perm) && int(job.Attempts) < maxAttempts {
		next := time.Now().Add(backoff[job.Attempts-1])
		slog.Warn("job failed, will retry", "job", job.ID, "kind", job.Kind, "attempt", job.Attempts, "err", err)
		if err := r.store.RetryJob(done, dbgen.RetryJobParams{ID: job.ID, RunAfter: next, LastError: &msg}); err != nil {
			slog.Error("retry job", "job", job.ID, "err", err)
		}
		return true
	}
	slog.Error("job failed permanently", "job", job.ID, "kind", job.Kind, "attempt", job.Attempts, "err", err)
	if err := r.store.FailJob(done, dbgen.FailJobParams{ID: job.ID, LastError: &msg}); err != nil {
		slog.Error("fail job", "job", job.ID, "err", err)
	}
	if f := r.failed[job.Kind]; f != nil {
		f(done, job.Payload, err)
	}
	return true
}

func runSafely(ctx context.Context, h Handler, payload []byte) (err error) {
	defer func() {
		if p := recover(); p != nil {
			err = fmt.Errorf("job panicked: %v", p)
		}
	}()
	return h(ctx, payload)
}
