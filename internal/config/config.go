package config

import (
	"errors"
	"fmt"
	"os"
	"regexp"
	"strings"
)

type Config struct {
	HTTPAddr         string
	DatabaseURL      string
	StorageDir       string
	PrintTokenSecret string
	GotenbergURL     string
	PublicBaseURL    string
	// PrintBaseURL is the origin Gotenberg uses to open print pages (e.g. http://app:8080).
	PrintBaseURL string
	// BasePath mounts the whole app under a path prefix ("/health") when it shares a
	// domain with other sites; empty serves from the root.
	BasePath string
}

func Load() (Config, error) {
	base, err := NormalizeBasePath(os.Getenv("BASE_PATH"))
	if err != nil {
		return Config{}, err
	}
	c := Config{
		HTTPAddr:         getenv("HTTP_ADDR", ":8080"),
		DatabaseURL:      os.Getenv("DATABASE_URL"),
		StorageDir:       getenv("STORAGE_DIR", "./data/storage"),
		PrintTokenSecret: os.Getenv("PRINT_TOKEN_SECRET"),
		GotenbergURL:     os.Getenv("GOTENBERG_URL"),
		PublicBaseURL:    os.Getenv("PUBLIC_BASE_URL"),
		PrintBaseURL:     os.Getenv("PRINT_BASE_URL"),
		BasePath:         base,
	}
	if c.DatabaseURL == "" {
		return c, errors.New("DATABASE_URL is required")
	}
	return c, nil
}

// CookieSecure is false only for plain-http local development.
func (c Config) CookieSecure() bool {
	return !strings.HasPrefix(c.PublicBaseURL, "http://")
}

// NormalizeBasePath accepts "", "/", "/health" or "/health/" and returns "" or "/health".
func NormalizeBasePath(p string) (string, error) {
	p = strings.TrimRight(strings.TrimSpace(p), "/")
	if p == "" {
		return "", nil
	}
	if !basePathRe.MatchString(p) {
		return "", fmt.Errorf("BASE_PATH %q must look like /health", p)
	}
	return p, nil
}

var basePathRe = regexp.MustCompile(`^(/[A-Za-z0-9][A-Za-z0-9._-]*)+$`)

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
