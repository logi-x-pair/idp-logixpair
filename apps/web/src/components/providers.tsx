"use client";

import { Toaster } from "@krazil-idp/ui/components/sonner";

import { ThemeProvider } from "./theme-provider";

export default function Providers({
	children,
	nonce,
}: {
	children: React.ReactNode;
	nonce?: string;
}) {
	return (
		<ThemeProvider
			attribute="class"
			defaultTheme="system"
			enableSystem
			disableTransitionOnChange
			nonce={nonce}
		>
			{children}
			<Toaster richColors />
		</ThemeProvider>
	);
}
