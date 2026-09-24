// Package report issues print tokens, talks to Gotenberg and assembles report data.
package report

import (
	"context"
	"fmt"
	"net/http"
	"strings"
)

type Gotenberg struct {
	BaseURL string
	Client  *http.Client
}

func (g *Gotenberg) Health(ctx context.Context) error {
	if g.BaseURL == "" {
		return fmt.Errorf("GOTENBERG_URL not configured")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(g.BaseURL, "/")+"/health", nil)
	if err != nil {
		return err
	}
	resp, err := g.Client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("gotenberg health: %s", resp.Status)
	}
	return nil
}
