// Package media wraps ffmpeg/ffprobe for audio and does JPEG thumbnails in pure Go.
package media

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/jpeg"
	"io"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"golang.org/x/image/draw"
)

// TranscodeAudio converts any browser recording (mp4/aac, webm/opus, ogg) to mono AAC m4a,
// playable on both iOS and Android, with the moov atom up front for streaming.
func TranscodeAudio(ctx context.Context, in, out string) error {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
		"-i", in, "-vn", "-ac", "1", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", "-f", "mp4", out)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("ffmpeg: %w: %s", err, strings.TrimSpace(tail(stderr.String(), 500)))
	}
	return nil
}

// ProbeDurationMs reads the container duration with ffprobe.
func ProbeDurationMs(ctx context.Context, path string) (int, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-show_entries", "format=duration",
		"-of", "default=noprint_wrappers=1:nokey=1", path).Output()
	if err != nil {
		return 0, fmt.Errorf("ffprobe: %w", err)
	}
	sec, err := strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
	if err != nil {
		return 0, fmt.Errorf("ffprobe duration %q: %w", out, err)
	}
	return int(sec*1000 + 0.5), nil
}

// Thumbnail decodes a JPEG and returns its size plus a JPEG no larger than maxSide on the long edge.
func Thumbnail(r io.Reader, maxSide int) (thumb []byte, width, height int, err error) {
	src, err := jpeg.Decode(r)
	if err != nil {
		return nil, 0, 0, fmt.Errorf("decode jpeg: %w", err)
	}
	b := src.Bounds()
	width, height = b.Dx(), b.Dy()

	tw, th := width, height
	if long := max(width, height); long > maxSide {
		tw = max(1, width*maxSide/long)
		th = max(1, height*maxSide/long)
	}
	dst := image.NewRGBA(image.Rect(0, 0, tw, th))
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, b, draw.Src, nil)

	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: 80}); err != nil {
		return nil, 0, 0, err
	}
	return buf.Bytes(), width, height, nil
}

func tail(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[len(s)-n:]
}
