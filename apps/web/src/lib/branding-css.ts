import { branding } from "@krazil-idp/branding/config";

function parseHex(hex: string): [number, number, number] {
	const h = hex.replace("#", "");
	const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
	return [
		Number.parseInt(full.slice(0, 2), 16),
		Number.parseInt(full.slice(2, 4), 16),
		Number.parseInt(full.slice(4, 6), 16),
	];
}

/**
 * Picks a readable text color (near-white or near-black) for content rendered
 * on top of `hexBackground`, using YIQ perceived-luminance weighting.
 */
function readableTextColor(hexBackground: string): string {
	const [r, g, b] = parseHex(hexBackground);
	const yiq = (r * 299 + g * 587 + b * 114) / 1000;
	return yiq >= 140 ? "#111111" : "#ffffff";
}

/**
 * Linear RGB mix of two hex colors; `t` = share of `b` (0..1). Used to derive
 * dark-scheme surfaces that keep a hint of the brand background's hue.
 */
function mixHex(a: string, b: string, t: number): string {
	const ca = parseHex(a);
	const cb = parseHex(b);
	const mixed = ca.map((v, i) => Math.round(v * (1 - t) + cb[i] * t));
	return `#${mixed.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * CSS injected into the root layout: exposes `--brand-*` variables and remaps
 * the design-system tokens (--primary, --ring, --background, --card, ...) in
 * BOTH color schemes so EVERY user-facing surface — sign-in, sign-up,
 * consent, error pages — re-skins from branding/config.ts alone.
 */
export function brandCssVariables(): string {
	const primaryForeground = readableTextColor(branding.primaryColor);
	// Dark-scheme surfaces derived from the brand background: mostly black,
	// tinted with the brand hue so dark mode rebrands too.
	const darkBackground = mixHex(branding.backgroundColor, "#09090b", 0.92);
	const darkCard = mixHex(branding.backgroundColor, "#151519", 0.9);
	return `
:root {
  --brand-primary: ${branding.primaryColor};
  --brand-primary-foreground: ${primaryForeground};
  --brand-bg: ${branding.backgroundColor};
  --brand-accent: ${branding.accentColor};
  --brand-font: ${branding.fontFamily};
  --primary: var(--brand-primary);
  --primary-foreground: var(--brand-primary-foreground);
  --ring: var(--brand-primary);
}
.dark {
  --primary: var(--brand-primary);
  --primary-foreground: var(--brand-primary-foreground);
  --ring: var(--brand-primary);
  --background: ${darkBackground};
  --card: ${darkCard};
}
body {
  font-family: var(--brand-font);
}
`;
}
