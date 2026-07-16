"use client";

import { Button } from "@krazil-idp/ui/components/button";
import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { SCOPE_DESCRIPTIONS } from "@/lib/scope-descriptions";

interface PublicClient {
	client_id: string;
	client_name?: string;
	client_uri?: string;
	logo_uri?: string;
}

/**
 * OAuth consent prompt. The provider redirects here with `client_id` and
 * `scope` query parameters plus the signed `oauth_query`, which the
 * oauthProviderClient plugin forwards automatically on the consent call.
 * Approve and deny BOTH navigate to the returned `redirect_uri` — deny
 * delivers the standard OAuth error to the client app.
 */
export default function ConsentForm() {
	const [client, setClient] = useState<PublicClient | null>(null);
	const [scopes, setScopes] = useState<string[]>([]);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState<"accept" | "deny" | null>(null);

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const clientId = params.get("client_id");
		setScopes(
			(params.get("scope") ?? "").split(" ").filter((s) => s.length > 0),
		);
		if (!clientId) {
			setLoadError("Missing client identifier — this consent link is invalid.");
			return;
		}
		authClient.oauth2
			.publicClient({ query: { client_id: clientId } })
			.then(({ data, error }) => {
				if (error || !data) {
					setLoadError(
						"We couldn't load the requesting application's details.",
					);
				} else {
					setClient(data as PublicClient);
				}
			});
	}, []);

	const decide = async (accept: boolean) => {
		setSubmitting(accept ? "accept" : "deny");
		try {
			// On approval, grant EXACTLY the scopes shown to the user (the server
			// validates the subset); on denial the scope list is irrelevant.
			const { data, error } = await authClient.oauth2.consent(
				accept ? { accept, scope: scopes.join(" ") } : { accept },
			);
			// NOTE: installed plugin returns { redirect, url } (docs' openapi
			// metadata still says redirect_uri — follow the installed types).
			if (error || !data?.url) {
				setLoadError(error?.message ?? "Consent could not be processed.");
				setSubmitting(null);
				return;
			}
			window.location.href = data.url;
		} catch {
			setLoadError("Consent could not be processed.");
			setSubmitting(null);
		}
	};

	if (loadError) {
		return (
			<p role="alert" className="text-destructive text-sm">
				{loadError}
			</p>
		);
	}

	if (!client) {
		return <p className="text-muted-foreground text-sm">Loading…</p>;
	}

	const clientName = client.client_name ?? "An application";

	return (
		<div>
			<div className="flex items-center gap-3">
				{client.logo_uri && (
					// eslint-disable-next-line @next/next/no-img-element -- client icons are remote URLs
					// biome-ignore lint/performance/noImgElement: client-provided remote icons are not static app assets
					<img
						src={client.logo_uri}
						alt=""
						className="h-10 w-10 rounded-md border"
					/>
				)}
				<div>
					<h1 className="font-semibold text-xl tracking-tight">{clientName}</h1>
					{client.client_uri && (
						<p className="text-muted-foreground text-xs">{client.client_uri}</p>
					)}
				</div>
			</div>

			<p className="mt-4 text-sm">
				<span className="font-medium">{clientName}</span> wants to:
			</p>
			<ul className="mt-3 space-y-2">
				{scopes.map((scope) => (
					<li key={scope} className="flex items-start gap-2 text-sm">
						<span aria-hidden className="mt-0.5 text-[var(--brand-accent)]">
							•
						</span>
						{SCOPE_DESCRIPTIONS[scope] ?? scope}
					</li>
				))}
			</ul>

			<div className="mt-8 flex gap-3">
				<Button
					variant="outline"
					className="flex-1"
					disabled={submitting !== null}
					onClick={() => decide(false)}
				>
					{submitting === "deny" ? "Cancelling…" : "Cancel"}
				</Button>
				<Button
					className="flex-1"
					disabled={submitting !== null}
					onClick={() => decide(true)}
				>
					{submitting === "accept" ? "Allowing…" : "Allow"}
				</Button>
			</div>

			<p className="mt-4 text-muted-foreground text-xs">
				You can revoke this access at any time from your account page.
			</p>
		</div>
	);
}
