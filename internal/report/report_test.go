package report

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestTokenRoundTrip(t *testing.T) {
	s, err := NewSigner(strings.Repeat("k", 32))
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 9, 24, 12, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }

	c := Claims{Family: uuid.New(), Type: "episode", ID: uuid.New(), Member: uuid.New(), Photos: "none"}
	tok, err := s.Sign(c)
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.Verify(tok)
	if err != nil || got.ID != c.ID || got.Family != c.Family {
		t.Fatalf("Verify = %+v, %v", got, err)
	}

	tampered := strings.Replace(tok, tok[:4], "AAAA", 1)
	if _, err := s.Verify(tampered); !errors.Is(err, ErrInvalidToken) {
		t.Fatal("tampered token accepted")
	}
	other, _ := NewSigner(strings.Repeat("x", 32))
	if _, err := other.Verify(tok); !errors.Is(err, ErrInvalidToken) {
		t.Fatal("token accepted with another key")
	}
	now = now.Add(TokenTTL + time.Second)
	if _, err := s.Verify(tok); !errors.Is(err, ErrInvalidToken) {
		t.Fatal("expired token accepted")
	}
	if _, err := NewSigner("short"); err == nil {
		t.Fatal("short secret accepted")
	}
}

func TestConvertURL(t *testing.T) {
	var gotURL, gotWait string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/forms/chromium/convert/url" {
			http.NotFound(w, r)
			return
		}
		gotURL, gotWait = r.FormValue("url"), r.FormValue("waitForExpression")
		w.Write([]byte("%PDF-1.7"))
	}))
	defer srv.Close()

	g := &Gotenberg{BaseURL: srv.URL, Client: srv.Client()}
	rc, err := g.ConvertURL(context.Background(), "http://app:8080/print/episode/1?token=t")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(rc)
	rc.Close()
	if string(b) != "%PDF-1.7" || gotURL != "http://app:8080/print/episode/1?token=t" || !strings.Contains(gotWait, "__PRINT_READY__") {
		t.Fatalf("pdf=%q url=%q wait=%q", b, gotURL, gotWait)
	}

	bad := &Gotenberg{BaseURL: srv.URL + "/nope", Client: srv.Client()}
	if _, err := bad.ConvertURL(context.Background(), "x"); err == nil {
		t.Fatal("expected error on non-200")
	}
}
