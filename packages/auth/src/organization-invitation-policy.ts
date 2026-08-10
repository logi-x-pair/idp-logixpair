import type { invitation } from "@krazil-idp/db/schema/organization";

import { recordAdminAuditEvent } from "./admin-audit";
import {
	OrganizationPolicyError,
	type OrganizationPolicyErrorCode,
	validateOrganizationPolicyRole as validateRole,
} from "./organization-policy";
import type { PolicyTransaction } from "./platform-policy";

export interface InvitationContext {
	actorUserId: string;
	organizationId: string;
	requestId: string;
	ipAddress?: string;
}

export interface InviteOrganizationMemberInput extends InvitationContext {
	email: string;
	role: "admin" | "moderator" | "user";
	expiresInSeconds?: number;
}

export interface ResolveOrganizationInvitationInput {
	actorUserId: string;
	invitationId: string;
	requestId: string;
	ipAddress?: string;
}

export interface CancelOrganizationInvitationInput extends InvitationContext {
	invitationId: string;
}

export interface OrganizationInvitation {
	id: string;
	organizationId: string;
	email: string;
	role: "admin" | "moderator" | "user";
	status: "pending" | "accepted" | "rejected" | "cancelled" | "expired";
	expiresAt: Date;
}

export type OrganizationInvitationOperationResult<T> =
	| { value: T; error?: never }
	| { value?: never; error: OrganizationPolicyError };

export function organizationInvitationError(
	code: OrganizationPolicyErrorCode,
	message: string,
): OrganizationPolicyError {
	return new OrganizationPolicyError(code, message);
}

export function validateInvitationRequest(input: {
	actorUserId: string;
	requestId: string;
}): void {
	if (!input.actorUserId || !input.requestId || input.requestId.length > 128) {
		throw organizationInvitationError(
			"INVALID_INPUT",
			"Invitation request context is invalid",
		);
	}
}

export function mapOrganizationInvitation(
	row: typeof invitation.$inferSelect,
): OrganizationInvitation {
	return {
		id: row.id,
		organizationId: row.organizationId,
		email: row.email,
		role: validateRole(row.role ?? "user"),
		status: row.status as OrganizationInvitation["status"],
		expiresAt: row.expiresAt,
	};
}

export async function denyOrganizationInvitation<T>(
	transaction: PolicyTransaction,
	input: { actorUserId: string; requestId: string; ipAddress?: string },
	organizationId: string | undefined,
	targetId: string | undefined,
	eventType:
		| "admin.member.invited"
		| "admin.member.invitation_cancelled"
		| "admin.member.invitation_rejected"
		| "admin.member.added",
	code: "POLICY_DENIED" | "NOT_FOUND" | "CONFLICT" | "INVALID_INPUT",
	message: string,
): Promise<OrganizationInvitationOperationResult<T>> {
	await recordAdminAuditEvent(transaction, {
		eventType,
		outcome: "denied",
		reasonCode:
			code === "POLICY_DENIED"
				? "policy_denied"
				: code === "NOT_FOUND"
					? "not_found"
					: code === "CONFLICT"
						? "conflict"
						: "invalid_input",
		requestId: input.requestId,
		actorUserId: input.actorUserId,
		organizationId,
		targetId,
		ipAddress: input.ipAddress,
	});
	return { error: organizationInvitationError(code, message) };
}
