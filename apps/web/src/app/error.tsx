"use client";

import { branding } from "@krazil-idp/branding/config";
import { useEffect } from "react";

/** Branded top-level error boundary: unexpected runtime failures never show a bare stack. */
export default function GlobalError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	useEffect(() => {
		console.error("unhandled UI error", error);
	}, [error]);

	return (
		<main className="flex min-h-svh flex-col items-center justify-center bg-[var(--brand-bg)] px-4 dark:bg-background">
			<div className="w-full max-w-md rounded-xl border bg-card p-8 text-card-foreground shadow-sm">
				<h1 className="font-semibold text-2xl tracking-tight">
					Something went wrong
				</h1>
				<p className="mt-3 text-muted-foreground text-sm">
					An unexpected error occurred. Please try again, or contact support if
					it keeps happening.
				</p>
				<div className="mt-6 flex flex-col gap-3">
					<button
						type="button"
						onClick={reset}
						className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 font-medium text-primary-foreground text-sm hover:opacity-90"
					>
						Try again
					</button>
					<a
						href={branding.supportUrl}
						className="text-center text-muted-foreground text-sm underline-offset-4 hover:underline"
					>
						Contact support
					</a>
				</div>
			</div>
		</main>
	);
}
