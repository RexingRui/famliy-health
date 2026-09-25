// Package report issues print tokens and asks Gotenberg (headless Chromium) to render the
// frontend print page to PDF.
package report

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"mime/multipart"
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

// ConvertURL renders pageURL as an A4 PDF. The page sets window.__PRINT_READY__ once charts
// have drawn, so Gotenberg waits for that instead of a fixed delay.
func (g *Gotenberg) ConvertURL(ctx context.Context, pageURL string) (io.ReadCloser, error) {
	if g.BaseURL == "" {
		return nil, fmt.Errorf("GOTENBERG_URL not configured")
	}
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	fields := [][2]string{
		{"url", pageURL},
		{"waitForExpression", "window.__PRINT_READY__ === true"},
		{"paperWidth", "8.27"},
		{"paperHeight", "11.7"},
		{"marginTop", "0.4"},
		{"marginBottom", "0.4"},
		{"marginLeft", "0.4"},
		{"marginRight", "0.4"},
		{"printBackground", "true"},
		{"failOnHttpStatusCodes", "[499,599]"},
	}
	for _, f := range fields {
		if err := w.WriteField(f[0], f[1]); err != nil {
			return nil, err
		}
	}
	if err := w.Close(); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(g.BaseURL, "/")+"/forms/chromium/convert/url", &body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	resp, err := g.Client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("gotenberg: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("gotenberg: %s: %s", resp.Status, strings.TrimSpace(string(msg)))
	}
	return resp.Body, nil
}
