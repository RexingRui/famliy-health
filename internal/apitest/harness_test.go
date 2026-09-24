// Package apitest runs end-to-end API tests against a real PostgreSQL. Each test gets its own
// schema. Set TEST_DATABASE_URL to run them, e.g.
// TEST_DATABASE_URL=postgres://healthlog:healthlog@localhost:5432/healthlog?sslmode=disable
package apitest

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"testing/fstest"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rexingrui/famliy-health/internal/api"
	"github.com/rexingrui/famliy-health/internal/handler"
	"github.com/rexingrui/famliy-health/internal/httpx"
	"github.com/rexingrui/famliy-health/internal/jobs"
	"github.com/rexingrui/famliy-health/internal/report"
	"github.com/rexingrui/famliy-health/internal/service"
	"github.com/rexingrui/famliy-health/internal/storage"
	"github.com/rexingrui/famliy-health/internal/store"
)

type env struct {
	t      *testing.T
	srv    *httptest.Server
	svc    *service.Service
	st     *store.Store
	runner *jobs.Runner
	files  *storage.Local

	mu        sync.Mutex
	printURLs []string
}

func newEnv(t *testing.T) *env {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	schema := "t_" + hex.EncodeToString(b)
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		_, _ = admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
		admin.Close()
	})
	if err := store.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}

	e := &env{t: t, st: store.New(pool)}
	e.files, err = storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	e.runner = jobs.NewRunner(e.st)
	e.svc = service.New(e.st, e.files, nil)
	e.runner.Handle(jobs.KindTranscodeAudio, e.svc.TranscodeJob, e.svc.TranscodeFailed)
	e.runner.Handle(jobs.KindDeleteFiles, e.svc.DeleteFilesJob, nil)

	gotenberg := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		e.mu.Lock()
		e.printURLs = append(e.printURLs, r.FormValue("url"))
		e.mu.Unlock()
		_, _ = w.Write([]byte("%PDF-1.7 fake"))
	}))
	t.Cleanup(gotenberg.Close)
	signer, err := report.NewSigner(strings.Repeat("s", 32))
	if err != nil {
		t.Fatal(err)
	}
	e.svc.SetReports(service.Reports{
		Signer: signer, Gotenberg: &report.Gotenberg{BaseURL: gotenberg.URL, Client: gotenberg.Client()},
		PrintBaseURL: "http://app.internal:8080",
	})

	h := handler.New(handler.Options{Service: e.svc, CookieSecure: false, Checks: map[string]handler.Checker{"database": pool}})
	e.srv = httptest.NewServer(httpx.NewRouter(httpx.Options{
		Server:            h,
		StrictMiddlewares: []api.StrictMiddlewareFunc{h.AuthMiddleware},
		Web:               fstest.MapFS{"index.html": {Data: []byte("<html></html>")}},
		PublicBaseURL:     "http://public.example",
	}))
	t.Cleanup(e.srv.Close)
	return e
}

// runJobs drains all due jobs.
func (e *env) runJobs() {
	for e.runner.RunOnce(context.Background()) {
	}
}

type client struct {
	e  *env
	hc *http.Client
}

func (e *env) anon() *client {
	jar, _ := cookiejar.New(nil)
	return &client{e: e, hc: &http.Client{Jar: jar}}
}

// account creates an account (the first one creates the family) and logs in.
func (e *env) account(username string) *client {
	e.t.Helper()
	if _, err := e.svc.CreateAccount(context.Background(), username, "password-123", "", "测试家庭"); err != nil {
		e.t.Fatal(err)
	}
	c := e.anon()
	res := c.do("POST", "/api/auth/login", map[string]string{"username": username, "password": "password-123"})
	res.expect(200)
	return c
}

type response struct {
	t      *testing.T
	status int
	header http.Header
	body   []byte
}

func (r response) expect(status int) response {
	r.t.Helper()
	if r.status != status {
		r.t.Fatalf("status %d, want %d: %s", r.status, status, r.body)
	}
	return r
}

func (r response) decode(v any) {
	r.t.Helper()
	if err := json.Unmarshal(r.body, v); err != nil {
		r.t.Fatalf("decode %s: %v", r.body, err)
	}
}

// errorFields returns the error code and field map of an error response.
func (r response) errorFields() (string, map[string]string) {
	r.t.Helper()
	var e api.Error
	r.decode(&e)
	if e.Error.Fields == nil {
		return e.Error.Code, map[string]string{}
	}
	return e.Error.Code, *e.Error.Fields
}

func (c *client) raw(method, path string, body io.Reader, contentType string, header map[string]string) response {
	c.e.t.Helper()
	req, err := http.NewRequest(method, c.e.srv.URL+path, body)
	if err != nil {
		c.e.t.Fatal(err)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	req.Header.Set("Origin", c.e.srv.URL)
	for k, v := range header {
		req.Header.Set(k, v)
	}
	res, err := c.hc.Do(req)
	if err != nil {
		c.e.t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return response{t: c.e.t, status: res.StatusCode, header: res.Header, body: b}
}

func (c *client) do(method, path string, body any) response {
	c.e.t.Helper()
	var r io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			c.e.t.Fatal(err)
		}
		r = bytes.NewReader(b)
	}
	return c.raw(method, path, r, "application/json", nil)
}

func (c *client) upload(id uuid.UUID, fields map[string]string, file []byte) response {
	c.e.t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	for _, k := range []string{"kind", "recordId", "durationMs", "caption", "sortOrder"} {
		if v, ok := fields[k]; ok {
			_ = w.WriteField(k, v)
		}
	}
	fw, _ := w.CreateFormFile("file", "upload.bin")
	_, _ = fw.Write(file)
	_ = w.Close()
	return c.raw("PUT", "/api/attachments/"+id.String(), &buf, w.FormDataContentType(), nil)
}

func jpegBytes(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for x := range w {
		img.Set(x, h/2, color.RGBA{200, 50, 50, 255})
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func newID(t *testing.T) uuid.UUID {
	id, err := uuid.NewV7()
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// createMember is a shortcut returning the new member.
func (c *client) createMember(nickname string) api.Member {
	c.e.t.Helper()
	var m api.Member
	c.do("POST", "/api/members", map[string]any{
		"nickname": nickname, "relation": "child", "gender": "male", "birthDate": "2019-05-02",
	}).expect(201).decode(&m)
	return m
}

func (c *client) createEpisode(memberID uuid.UUID, disease, kind string) api.Episode {
	c.e.t.Helper()
	var e api.Episode
	c.do("POST", "/api/episodes", map[string]any{"memberId": memberID, "diseaseName": disease, "kind": kind}).expect(201).decode(&e)
	return e
}

func (c *client) putRecord(id uuid.UUID, body map[string]any) api.Record {
	c.e.t.Helper()
	var r api.Record
	c.do("PUT", "/api/records/"+id.String(), body).expect(201).decode(&r)
	return r
}

func must(t *testing.T, ok bool, format string, args ...any) {
	t.Helper()
	if !ok {
		t.Fatalf(format, args...)
	}
}
