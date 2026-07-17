/**
 * Structured audit log for security-relevant events: login success/failure,
 * token issuance, client secret rotation, consent grant/deny/revoke, token
 * revocation, lockouts.
 *
 * Emits single-line JSON to stdout so any log shipper can ingest it. Swap the
 * sink here if your platform wants something else.
 */

export type AuditEvent =
	| "login.success"
	| "login.failure"
	| "login.locked_out"
	| "token.issued"
	| "token.revoked"
	| "token.revoke_ignored"
	| "client.secret_rotated"
	| "consent.granted"
	| "consent.denied"
	| "consent.revoked"
	| "password.reset";

export function audit(
	event: AuditEvent,
	details: Record<string, unknown>,
): void {
	console.log(
		JSON.stringify({
			audit: true,
			event,
			at: new Date().toISOString(),
			...details,
		}),
	);
}
