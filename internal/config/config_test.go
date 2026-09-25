package config

import "testing"

func TestNormalizeBasePath(t *testing.T) {
	for in, want := range map[string]string{"": "", "/": "", "/health": "/health", "/health/": "/health", " /a/b ": "/a/b"} {
		if got, err := NormalizeBasePath(in); err != nil || got != want {
			t.Errorf("NormalizeBasePath(%q) = %q, %v", in, got, err)
		}
	}
	for _, bad := range []string{"health", "/he alth", "/../x", "/a//b"} {
		if _, err := NormalizeBasePath(bad); err == nil {
			t.Errorf("NormalizeBasePath(%q) accepted", bad)
		}
	}
}
