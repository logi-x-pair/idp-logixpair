/**
 * THE single source of truth for this deployment's visual identity.
 *
 * Re-branding for a new deployment = edit these values + swap the files in
 * `branding/assets/` (+ set the env vars in `.env`). Nothing outside this
 * folder may contain brand-specific values — see NEW_BRAND.md.
 *
 * Asset paths are served by the IdP at `/brand/<file>` from `branding/assets/`.
 */
export const branding = {
	brandName: "Acme ID",
	/** Logo shown on light backgrounds. */
	logoLight: "/brand/logo-light.svg",
	/** Logo shown on dark backgrounds. */
	logoDark: "/brand/logo-dark.svg",
	favicon: "/brand/favicon.svg",
	/** Primary action color (buttons, links, focus rings). */
	primaryColor: "#4f46e5",
	/** Page background behind auth cards. */
	backgroundColor: "#f6f7fb",
	/** Secondary highlight color. */
	accentColor: "#0ea5e9",
	fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
	supportUrl: "https://support.acme.example",
	termsUrl: "https://acme.example/terms",
	privacyUrl: "https://acme.example/privacy",
} as const;

export type Branding = typeof branding;
