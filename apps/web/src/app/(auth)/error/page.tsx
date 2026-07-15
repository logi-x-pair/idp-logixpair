import { branding } from "@krazil-idp/branding/config";
import Link from "next/link";

/**
 * Branded terminal page for OAuth/OIDC protocol errors (invalid redirect_uri,
 * tampered oauth_query signature, expired authorization requests, ...). The
 * flow cannot continue safely, so we stop here instead of redirecting anywhere
 * an attacker could control.
 */
export default async function AuthErrorPage({
	searchParams,
}: {
	searchParams: Promise<{ error?: string; error_description?: string }>;
}) {
	const { error, error_description } = await searchParams;

	return (
		<div>
			<h1 className="font-semibold text-2xl tracking-tight">
				Something went wrong
			</h1>
			<p className="mt-3 text-muted-foreground text-sm">
				We couldn't complete your sign-in request. This can happen when a link
				is expired, altered, or misconfigured.
			</p>

			{(error || error_description) && (
				<dl className="mt-4 rounded-md border bg-muted/40 px-3 py-2 text-sm">
					{error && (
						<div className="flex gap-2">
							<dt className="font-medium">Code:</dt>
							<dd className="text-muted-foreground">{error}</dd>
						</div>
					)}
					{error_description && (
						<div className="flex gap-2">
							<dt className="font-medium">Detail:</dt>
							<dd className="text-muted-foreground">{error_description}</dd>
						</div>
					)}
				</dl>
			)}

			<div className="mt-6 flex flex-col gap-3">
				<Link
					href="/sign-in"
					className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 font-medium text-primary-foreground text-sm hover:opacity-90"
				>
					Back to sign in
				</Link>
				<a
					href={branding.supportUrl}
					className="text-center text-muted-foreground text-sm underline-offset-4 hover:underline"
				>
					Contact support
				</a>
			</div>
		</div>
	);
}
