package web

import (
	"context"
	"errors"
	"fmt"

	"github.com/ysksm/my_logic_example/chrome_dev_tool/core/cdp"
)

// RenderParams mirrors the toggles in Chrome DevTools' "Rendering" panel.
// Empty string select fields mean "no override". Boolean fields are off by
// default. The server applies these statelessly: each call replaces the
// browser-side state with this exact configuration.
type RenderParams struct {
	// Visual debugging overlays (Overlay.setShow*)
	PaintFlashing         bool `json:"paintFlashing"`
	LayoutShiftRegions    bool `json:"layoutShiftRegions"`
	LayerBorders          bool `json:"layerBorders"`
	FPSCounter            bool `json:"fpsCounter"`
	ScrollBottleneckRects bool `json:"scrollBottleneckRects"`
	AdHighlights          bool `json:"adHighlights"`
	WebVitals             bool `json:"webVitals"`

	// CSS media type / features (Emulation.setEmulatedMedia)
	EmulatedMedia              string `json:"emulatedMedia,omitempty"`              // "" | "screen" | "print"
	PrefersColorScheme         string `json:"prefersColorScheme,omitempty"`         // "" | "light" | "dark"
	PrefersReducedMotion       string `json:"prefersReducedMotion,omitempty"`       // "" | "reduce" | "no-preference"
	PrefersReducedData         string `json:"prefersReducedData,omitempty"`         // "" | "reduce" | "no-preference"
	PrefersReducedTransparency string `json:"prefersReducedTransparency,omitempty"` // "" | "reduce" | "no-preference"
	PrefersContrast            string `json:"prefersContrast,omitempty"`            // "" | "more" | "less" | "custom" | "no-preference"
	ForcedColors               string `json:"forcedColors,omitempty"`               // "" | "active" | "none"
	ColorGamut                 string `json:"colorGamut,omitempty"`                 // "" | "srgb" | "p3" | "rec2020"

	// Vision deficiency (Emulation.setEmulatedVisionDeficiency).
	// Allowed: "none" | "achromatopsia" | "blurredVision" | "deuteranopia"
	//        | "protanopia" | "tritanopia" | "reducedContrast"
	VisionDeficiency string `json:"visionDeficiency,omitempty"`

	// Auto dark mode (Emulation.setAutoDarkModeOverride).
	AutoDarkMode bool `json:"autoDarkMode"`

	// Asset emulation
	LocalFontsDisabled bool     `json:"localFontsDisabled"`           // !enabled
	DisabledImageTypes []string `json:"disabledImageTypes,omitempty"` // {"avif","jxl","webp"}
}

// RenderResult is what /api/render returns.
type RenderResult struct {
	Applied  RenderParams `json:"applied"`
	Warnings []string     `json:"warnings,omitempty"`
}

// applyRendering sends the full RenderParams to the attached Chrome target.
// Individual commands may fail because the build is too old or the option
// is experimental. Such failures become warnings (returned to the caller)
// rather than hard errors; only "not attached" returns error.
func applyRendering(ctx context.Context, cl *cdp.Client, p RenderParams) (RenderResult, error) {
	if cl == nil {
		return RenderResult{}, errors.New("not attached")
	}
	// Overlay.enable is harmless if already enabled — set* commands need it.
	_, _ = cl.Send(ctx, "Overlay.enable", nil)

	var warnings []string
	send := func(method string, params any) {
		if _, err := cl.Send(ctx, method, params); err != nil {
			warnings = append(warnings, fmt.Sprintf("%s: %v", method, err))
		}
	}

	// ─── Overlay debugging ─────────────────────────────────────────────
	send("Overlay.setShowPaintRects", map[string]any{"result": p.PaintFlashing})
	send("Overlay.setShowLayoutShiftRegions", map[string]any{"result": p.LayoutShiftRegions})
	send("Overlay.setShowDebugBorders", map[string]any{"show": p.LayerBorders})
	send("Overlay.setShowFPSCounter", map[string]any{"show": p.FPSCounter})
	send("Overlay.setShowScrollBottleneckRects", map[string]any{"show": p.ScrollBottleneckRects})
	send("Overlay.setShowAdHighlights", map[string]any{"show": p.AdHighlights})
	send("Overlay.setShowWebVitals", map[string]any{"show": p.WebVitals})

	// ─── CSS media ─────────────────────────────────────────────────────
	features := []map[string]string{}
	addFeat := func(name, value string) {
		if value == "" {
			return
		}
		features = append(features, map[string]string{"name": name, "value": value})
	}
	addFeat("prefers-color-scheme", p.PrefersColorScheme)
	addFeat("prefers-reduced-motion", p.PrefersReducedMotion)
	addFeat("prefers-reduced-data", p.PrefersReducedData)
	addFeat("prefers-reduced-transparency", p.PrefersReducedTransparency)
	addFeat("prefers-contrast", p.PrefersContrast)
	addFeat("forced-colors", p.ForcedColors)
	addFeat("color-gamut", p.ColorGamut)
	mediaParams := map[string]any{"features": features}
	if p.EmulatedMedia != "" {
		mediaParams["media"] = p.EmulatedMedia
	} else {
		mediaParams["media"] = ""
	}
	send("Emulation.setEmulatedMedia", mediaParams)

	// ─── Vision deficiency ─────────────────────────────────────────────
	visType := p.VisionDeficiency
	if visType == "" {
		visType = "none"
	}
	send("Emulation.setEmulatedVisionDeficiency", map[string]any{"type": visType})

	// ─── Auto dark mode ────────────────────────────────────────────────
	// Empty params == clear override. {enabled:true} == force dark.
	autoDark := map[string]any{}
	if p.AutoDarkMode {
		autoDark["enabled"] = true
	}
	send("Emulation.setAutoDarkModeOverride", autoDark)

	// ─── Local fonts ───────────────────────────────────────────────────
	send("Emulation.setLocalFontsEnabled", map[string]any{"enabled": !p.LocalFontsDisabled})

	// ─── Disabled image types ──────────────────────────────────────────
	// CDP's enum is locked to a specific set; filter out anything else so
	// one bad value doesn't sink the whole call.
	allowed := map[string]bool{"avif": true, "webp": true, "jxl": true}
	imageTypes := []string{}
	for _, t := range p.DisabledImageTypes {
		if allowed[t] {
			imageTypes = append(imageTypes, t)
		}
	}
	send("Emulation.setDisabledImageTypes", map[string]any{"imageTypes": imageTypes})

	return RenderResult{Applied: p, Warnings: warnings}, nil
}
