"use client";

import { Button } from "@krazil-idp/ui/components/button";
import { useCallback, useEffect, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { SCOPE_DESCRIPTIONS } from "@/lib/scope-descriptions";

interface Consent {
	id: string;
	clientId: string;
	scopes: string[];
	createdAt: string | Date;
	clientName?: string;
}

/** Lists the applications a user has granted access to, with revocation. */
export default function ConsentList() {
	const [consents, setConsents] = useState<Consent[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	// Revocation is a two-step, per-row confirmation: the first click arms the
	// row (confirmingId), the second click actually revokes.
	const [confirmingId, setConfirmingId] = useState<string | null>(null);
	const [revoking, setRevoking] = useState(false);

	const load = useCallback(async () => {
		const { data, error: listError } = await authClient.oauth2.getConsents();
		if (listError || !data) {
			setError("Couldn't load your connected applications.");
			return;
		}
		const rows = (data as Consent[] | null) ?? [];
		// Resolve client display names for each consent.
		const withNames = await Promise.all(
			rows.map(async (row) => {
				const { data: client } = await authClient.oauth2.publicClient({
					query: { client_id: row.clientId },
				});
				return { ...row, clientName: client?.client_name ?? row.clientId };
			}),
		);
		setConsents(withNames);
	}, []);

	useEffect(() => {
		load();
	}, [load]);

	const revoke = async (id: string) => {
		setRevoking(true);
		setError(null);
		try {
			const { error: revokeError } = await authClient.oauth2.deleteConsent({
				id,
			});
			if (revokeError) {
				setError("Couldn't revoke access. Try again.");
				return;
			}
			await load();
		} catch {
			setError("Couldn't revoke access. Try again.");
		} finally {
			setRevoking(false);
			setConfirmingId(null);
		}
	};

	if (consents === null) {
		if (error) {
			return (
				<p role="alert" className="text-destructive text-sm">
					{error}
				</p>
			);
		}
		return <p className="text-muted-foreground text-sm">Loading…</p>;
	}
	if (consents.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				You haven't granted any applications access to your account.
			</p>
		);
	}

	return (
		<div>
			{error ? (
				<p role="alert" className="mb-4 text-destructive text-sm">
					{error}
				</p>
			) : null}
			<ul className="space-y-4">
				{consents.map((consent) => {
					const isConfirming = confirmingId === consent.id;
					return (
						<li key={consent.id} className="rounded-lg border p-4">
							<div className="flex items-center justify-between gap-4">
								<div>
									<p className="font-medium text-sm">{consent.clientName}</p>
									<ul className="mt-1 text-muted-foreground text-xs">
										{consent.scopes.map((scope) => (
											<li key={scope}>{SCOPE_DESCRIPTIONS[scope] ?? scope}</li>
										))}
									</ul>
								</div>
								{isConfirming ? (
									<div className="flex shrink-0 items-center gap-2">
										<Button
											variant="ghost"
											size="sm"
											disabled={revoking}
											onClick={() => setConfirmingId(null)}
											aria-label={`Cancel revoking access for ${consent.clientName}`}
										>
											Cancel
										</Button>
										<Button
											variant="destructive"
											size="sm"
											disabled={revoking}
											onClick={() => revoke(consent.id)}
											aria-label={`Confirm revoking access for ${consent.clientName}`}
										>
											{revoking ? "Revoking…" : "Confirm revoke"}
										</Button>
									</div>
								) : (
									<Button
										variant="destructive"
										size="sm"
										disabled={revoking}
										onClick={() => setConfirmingId(consent.id)}
										aria-label={`Revoke access for ${consent.clientName}`}
									>
										Revoke
									</Button>
								)}
							</div>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
