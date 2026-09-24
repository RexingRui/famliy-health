package config

import (
	"errors"
	"os"
)

type Config struct {
	HTTPAddr         string
	DatabaseURL      string
	StorageDir       string
	SessionSecret    string
	PrintTokenSecret string
	GotenbergURL     string
	PublicBaseURL    string
}

func Load() (Config, error) {
	c := Config{
		HTTPAddr:         getenv("HTTP_ADDR", ":8080"),
		DatabaseURL:      os.Getenv("DATABASE_URL"),
		StorageDir:       getenv("STORAGE_DIR", "./data/storage"),
		SessionSecret:    os.Getenv("SESSION_SECRET"),
		PrintTokenSecret: os.Getenv("PRINT_TOKEN_SECRET"),
		GotenbergURL:     os.Getenv("GOTENBERG_URL"),
		PublicBaseURL:    os.Getenv("PUBLIC_BASE_URL"),
	}
	if c.DatabaseURL == "" {
		return c, errors.New("DATABASE_URL is required")
	}
	return c, nil
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
