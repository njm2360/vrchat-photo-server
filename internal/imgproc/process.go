package imgproc

import (
	"bytes"
	"fmt"
	"image"
	_ "image/gif"
	"image/jpeg"
	"image/png"
	"io"

	"github.com/chai2010/webp"
	"golang.org/x/image/draw"
)

type Info struct {
	Width    int
	Height   int
	MIMEType string
	Ext      string
	Data     []byte
}

const maxPixels = 32 << 20 // 32 million pixels (~128 MB as RGBA)

// Decode decodes raw image bytes and returns the decoded image plus format info.
func Decode(data []byte) (image.Image, string, error) {
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, "", fmt.Errorf("decode image config: %w", err)
	}
	if int64(cfg.Width)*int64(cfg.Height) > maxPixels {
		return nil, "", fmt.Errorf("image dimensions %dx%d exceed pixel limit", cfg.Width, cfg.Height)
	}
	img, format, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, "", fmt.Errorf("decode image: %w", err)
	}
	return img, format, nil
}

// FitWithin resizes img to fit within maxW x maxH while preserving aspect ratio.
// Returns the original image if it already fits.
func FitWithin(img image.Image, maxW, maxH int) image.Image {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= maxW && h <= maxH {
		return img
	}
	scaleW := float64(maxW) / float64(w)
	scaleH := float64(maxH) / float64(h)
	scale := scaleW
	if scaleH < scale {
		scale = scaleH
	}
	newW := max(1, int(float64(w)*scale))
	newH := max(1, int(float64(h)*scale))

	dst := image.NewRGBA(image.Rect(0, 0, newW, newH))
	draw.CatmullRom.Scale(dst, dst.Bounds(), img, b, draw.Over, nil)
	return dst
}

// Rotate rotates img clockwise by degrees (0, 90, 180, or 270).
func Rotate(img image.Image, degrees int) image.Image {
	switch degrees % 360 {
	case 90:
		return rotate90(img)
	case 180:
		return rotate180(img)
	case 270:
		return rotate270(img)
	default:
		return img
	}
}

func rotate90(img image.Image) image.Image {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	dst := image.NewRGBA(image.Rect(0, 0, h, w))
	for y := range h {
		for x := range w {
			dst.Set(h-1-y, x, img.At(b.Min.X+x, b.Min.Y+y))
		}
	}
	return dst
}

func rotate180(img image.Image) image.Image {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			dst.Set(w-1-x, h-1-y, img.At(b.Min.X+x, b.Min.Y+y))
		}
	}
	return dst
}

func rotate270(img image.Image) image.Image {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	dst := image.NewRGBA(image.Rect(0, 0, h, w))
	for y := range h {
		for x := range w {
			dst.Set(y, w-1-x, img.At(b.Min.X+x, b.Min.Y+y))
		}
	}
	return dst
}

// MakeThumb creates a 96x96 WebP thumbnail from img.
func MakeThumb(img image.Image) ([]byte, error) {
	thumb := FitWithin(img, 96, 96)
	var buf bytes.Buffer
	if err := webp.Encode(&buf, thumb, &webp.Options{Quality: 80}); err != nil {
		return nil, fmt.Errorf("encode thumb webp: %w", err)
	}
	return buf.Bytes(), nil
}

// Encode re-encodes img to the given MIME type. Falls back to PNG for unknown types.
func Encode(img image.Image, mimeType string) ([]byte, error) {
	var buf bytes.Buffer
	switch mimeType {
	case "image/jpeg":
		// Flatten to opaque RGBA before JPEG encoding.
		flat := flattenToRGBA(img)
		if err := jpeg.Encode(&buf, flat, &jpeg.Options{Quality: 90}); err != nil {
			return nil, fmt.Errorf("encode jpeg: %w", err)
		}
	case "image/webp":
		if err := webp.Encode(&buf, img, &webp.Options{Quality: 85}); err != nil {
			return nil, fmt.Errorf("encode webp: %w", err)
		}
	default: // image/png, image/gif, etc.
		if err := png.Encode(&buf, img); err != nil {
			return nil, fmt.Errorf("encode png: %w", err)
		}
	}
	return buf.Bytes(), nil
}

// EncodePNG encodes img as PNG (used for proxy output).
func EncodePNG(w io.Writer, img image.Image) error {
	return png.Encode(w, img)
}

// FormatToMIME maps image.Decode format strings to MIME types.
func FormatToMIME(format string) (mimeType, ext string) {
	switch format {
	case "jpeg":
		return "image/jpeg", "jpg"
	case "png":
		return "image/png", "png"
	case "gif":
		return "image/gif", "gif"
	case "webp":
		return "image/webp", "webp"
	default:
		return "image/png", "png"
	}
}

func flattenToRGBA(img image.Image) image.Image {
	b := img.Bounds()
	dst := image.NewRGBA(b)
	draw.Draw(dst, b, image.White, image.Point{}, draw.Src)
	draw.Draw(dst, b, img, b.Min, draw.Over)
	return dst
}
