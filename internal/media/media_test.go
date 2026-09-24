package media

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/jpeg"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestThumbnail(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 2000, 1000))
	for x := range 2000 {
		img.Set(x, 500, color.White)
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatal(err)
	}
	thumb, w, h, err := Thumbnail(&buf, 400)
	if err != nil {
		t.Fatal(err)
	}
	if w != 2000 || h != 1000 {
		t.Fatalf("original size %dx%d", w, h)
	}
	cfg, err := jpeg.DecodeConfig(bytes.NewReader(thumb))
	if err != nil || cfg.Width != 400 || cfg.Height != 200 {
		t.Fatalf("thumb %dx%d, %v", cfg.Width, cfg.Height, err)
	}
	if _, _, _, err := Thumbnail(bytes.NewReader([]byte("not a jpeg")), 400); err == nil {
		t.Fatal("expected decode error")
	}
}

func TestTranscodeAudio(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not installed")
	}
	ctx := context.Background()
	dir := t.TempDir()
	in := filepath.Join(dir, "in.webm")
	gen := exec.Command("ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
		"-c:a", "libopus", in)
	if out, err := gen.CombinedOutput(); err != nil {
		t.Skipf("cannot generate opus fixture: %v %s", err, out)
	}
	out := filepath.Join(dir, "out.m4a")
	if err := TranscodeAudio(ctx, in, out); err != nil {
		t.Fatal(err)
	}
	ms, err := ProbeDurationMs(ctx, out)
	if err != nil {
		t.Fatal(err)
	}
	if ms < 1800 || ms > 2300 {
		t.Fatalf("duration %dms", ms)
	}
	if err := TranscodeAudio(ctx, filepath.Join(dir, "missing.webm"), out); err == nil {
		t.Fatal("expected error for missing input")
	}
}
