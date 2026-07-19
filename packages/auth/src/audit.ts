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
	| "login.two_factor_failure"
	| "token.issued"
	| "token.revoked"
	| "token.revoke_ignored"
	| "client.created"
	| "client.updated"
	| "client.deleted"
	| "client.secret_rotated"
	| "consent.granted"
	| "consent.denied"
	| "consent.revoked"
	| "password.reset"
	| "admin.protected_target_rejected"
	| "admin.update_fields_rejected"
	| "user.tokens_revoked"
	| "token.banned_user_rejected";

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
