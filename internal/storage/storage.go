// Package storage keeps attachment files outside the database. The MVP uses local disk
// (STORAGE_DIR, a mounted volume); object storage can implement the same interface later.
package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
)

type File interface {
	io.ReadSeekCloser
	Stat() (fs.FileInfo, error)
}

type Storage interface {
	// Put writes r to key atomically and returns the number of bytes written.
	Put(ctx context.Context, key string, r io.Reader) (int64, error)
	Open(ctx context.Context, key string) (File, error)
	// Delete removes key; a missing key is not an error.
	Delete(ctx context.Context, key string) error
}

// LocalPather is implemented by storages that can hand ffmpeg a filesystem path directly.
type LocalPather interface {
	LocalPath(key string) (string, error)
}

var ErrNotFound = errors.New("storage: not found")

type Local struct {
	Dir string
}

func NewLocal(dir string) (*Local, error) {
	dir, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return nil, fmt.Errorf("create storage dir: %w", err)
	}
	return &Local{Dir: dir}, nil
}

func (l *Local) LocalPath(key string) (string, error) {
	clean := path.Clean(key)
	if key == "" || strings.HasPrefix(clean, "/") || strings.HasPrefix(clean, "..") || clean != key {
		return "", fmt.Errorf("storage: invalid key %q", key)
	}
	return filepath.Join(l.Dir, filepath.FromSlash(clean)), nil
}

func (l *Local) Put(_ context.Context, key string, r io.Reader) (int64, error) {
	p, err := l.LocalPath(key)
	if err != nil {
		return 0, err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o750); err != nil {
		return 0, err
	}
	tmp, err := os.CreateTemp(filepath.Dir(p), ".upload-*")
	if err != nil {
		return 0, err
	}
	defer os.Remove(tmp.Name()) //nolint:errcheck // gone after rename
	n, err := io.Copy(tmp, r)
	if err != nil {
		tmp.Close()
		return n, err
	}
	if err := tmp.Close(); err != nil {
		return n, err
	}
	return n, os.Rename(tmp.Name(), p)
}

func (l *Local) Open(_ context.Context, key string) (File, error) {
	p, err := l.LocalPath(key)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(p)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, ErrNotFound
	}
	return f, err
}

func (l *Local) Delete(_ context.Context, key string) error {
	p, err := l.LocalPath(key)
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	// Remove now-empty parent directories up to the storage root; failures are harmless.
	for dir := filepath.Dir(p); dir != l.Dir && strings.HasPrefix(dir, l.Dir); dir = filepath.Dir(dir) {
		if os.Remove(dir) != nil {
			break
		}
	}
	return nil
}

// Key builds "<family>/<yyyy>/<mm>/<attachment>/<name>".
func Key(familyID, attachmentID string, at time.Time, name string) string {
	return fmt.Sprintf("%s/%04d/%02d/%s/%s", familyID, at.Year(), int(at.Month()), attachmentID, name)
}
