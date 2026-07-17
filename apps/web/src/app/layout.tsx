import { branding } from "@krazil-idp/branding/config";
import type { Metadata } from "next";
import { headers } from "next/headers";

import "../index.css";
import Providers from "@/components/providers";
import { brandCssVariables } from "@/lib/branding-css";

export const metadata: Metadata = {
	title: branding.brandName,
	description: `${branding.brandName} — single sign-on`,
	icons: [{ url: branding.favicon }],
};

// Nonce-based CSP (src/proxy.ts) requires dynamic rendering: statically
// prerendered pages would ship inline scripts without the per-request nonce
// and be blocked. An IdP has no cacheable public pages, so this is free.
export const dynamic = "force-dynamic";

export default async function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	// proxy.ts sets x-nonce in production so next-themes' injected inline script
	// carries the CSP nonce; undefined in development (relaxed CSP).
	const nonce = (await headers()).get("x-nonce") ?? undefined;
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				{/* Brand variables: generated from branding/config.ts (single source of truth). */}
				<style>{brandCssVariables()}</style>
			</head>
			<body className="antialiased">
				<Providers nonce={nonce}>{children}</Providers>
			</body>
		</html>
	);
}
