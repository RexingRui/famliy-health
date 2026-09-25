package storage

import (
	"context"
	"errors"
	"io"
	"os"
	"strings"
	"testing"
)

func TestLocalRoundTrip(t *testing.T) {
	ctx := context.Background()
	l, err := NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	key := "fam/2026/09/att/original.jpg"
	if n, err := l.Put(ctx, key, strings.NewReader("hello")); err != nil || n != 5 {
		t.Fatalf("Put = %d, %v", n, err)
	}
	f, err := l.Open(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(f)
	f.Close()
	if string(b) != "hello" {
		t.Fatalf("read %q", b)
	}
	if err := l.Delete(ctx, key); err != nil {
		t.Fatal(err)
	}
	if _, err := l.Open(ctx, key); !errors.Is(err, ErrNotFound) {
		t.Fatalf("after delete: %v", err)
	}
	if err := l.Delete(ctx, key); err != nil {
		t.Fatalf("second delete: %v", err)
	}
	if entries, _ := os.ReadDir(l.Dir); len(entries) != 0 {
		t.Fatalf("empty dirs left behind: %v", entries)
	}
}

func TestLocalRejectsTraversal(t *testing.T) {
	l, _ := NewLocal(t.TempDir())
	for _, key := range []string{"../etc/passwd", "/abs", "a/../../b", "a//b", ""} {
		if _, err := l.Put(context.Background(), key, strings.NewReader("x")); err == nil {
			t.Errorf("key %q accepted", key)
		}
	}
}
