import { branding } from "@krazil-idp/branding/config";

/**
 * Shared chrome for every user-facing auth surface (sign-in, sign-up,
 * consent, auth errors): brand logo on top, card in the middle, legal and
 * support links below. Everything it renders derives from branding/config.ts.
 */
export default function AuthShell({ children }: { children: React.ReactNode }) {
	return (
		<main className="flex min-h-svh flex-col items-center justify-center bg-[var(--brand-bg)] px-4 py-10 dark:bg-background">
			{/* eslint-disable-next-line @next/next/no-img-element -- brand assets are deployment-local files */}
			{/* biome-ignore lint/performance/noImgElement: deployment-local brand assets are not remote optimized content */}
			<img
				src={branding.logoLight}
				alt={branding.brandName}
				className="mb-8 h-10 dark:hidden"
			/>
			{/* eslint-disable-next-line @next/next/no-img-element -- brand assets are deployment-local files */}
			{/* biome-ignore lint/performance/noImgElement: deployment-local brand assets are not remote optimized content */}
			<img
				src={branding.logoDark}
				alt={branding.brandName}
				className="mb-8 hidden h-10 dark:block"
			/>

			<div className="w-full max-w-md rounded-xl border bg-card p-8 text-card-foreground shadow-sm">
				{children}
			</div>

			<nav
				aria-label="Legal and support"
				className="mt-8 flex gap-6 text-muted-foreground text-sm"
			>
				<a className="hover:text-foreground" href={branding.termsUrl}>
					Terms
				</a>
				<a className="hover:text-foreground" href={branding.privacyUrl}>
					Privacy
				</a>
				<a className="hover:text-foreground" href={branding.supportUrl}>
					Support
				</a>
			</nav>
		</main>
	);
}
