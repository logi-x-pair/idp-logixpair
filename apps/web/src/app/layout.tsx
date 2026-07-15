import { branding } from "@krazil-idp/branding/config";
import type { Metadata } from "next";

import "../index.css";
import Providers from "@/components/providers";
import { brandCssVariables } from "@/lib/branding-css";

export const metadata: Metadata = {
	title: branding.brandName,
	description: `${branding.brandName} — single sign-on`,
	icons: [{ url: branding.favicon }],
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				{/* Brand variables: generated from branding/config.ts (single source of truth). */}
				<style>{brandCssVariables()}</style>
			</head>
			<body className="antialiased">
				<Providers>{children}</Providers>
			</body>
		</html>
	);
}
