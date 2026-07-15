import { branding } from "@krazil-idp/branding/config";

/**
 * Picks a readable text color (near-white or near-black) for content rendered
 * on top of `hexBackground`, using YIQ perceived-luminance weighting.
 */
function readableTextColor(hexBackground: string): string {
	const hex = hexBackground.replace("#", "");
	const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex;
	const r = Number.parseInt(full.slice(0, 2), 16);
	const g = Number.parseInt(full.slice(2, 4), 16);
	const b = Number.parseInt(full.slice(4, 6), 16);
	const yiq = (r * 299 + g * 587 + b * 114) / 1000;
	return yiq >= 140 ? "#111111" : "#ffffff";
}

/**
 * CSS injected into the root layout: exposes `--brand-*` variables and remaps
 * the design-system tokens (--primary, --ring, ...) so EVERY user-facing
 * surface — sign-in, sign-up, consent, error pages — re-skins from
 * branding/config.ts alone.
 */
export function brandCssVariables(): string {
	const primaryForeground = readableTextColor(branding.primaryColor);
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
}
body {
  font-family: var(--brand-font);
}
`;
}
