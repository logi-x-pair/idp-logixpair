import { db } from "@krazil-idp/db";
import { user } from "@krazil-idp/db/schema/auth";
import {
	invitation,
	member,
	organization,
} from "@krazil-idp/db/schema/organization";
import { and, eq, lte } from "drizzle-orm";

import { recordAdminAuditEvent } from "./admin-audit";
import type {
	OrganizationInvitationOperationResult as OperationResult,
	OrganizationInvitation,
	ResolveOrganizationInvitationInput,
} from "./organization-invitation-policy";
import {
	denyOrganizationInvitation as denied,
	mapOrganizationInvitation as mapInvitation,
	validateInvitationRequest as validateRequest,
} from "./organization-invitation-policy";
import { validateOrganizationPolicyRole as validateRole } from "./organization-policy";

async function resolveInvitation(
	input: ResolveOrganizationInvitationInput,
	resolution: "accepted" | "rejected",
): Promise<OrganizationInvitation> {
	validateRequest(input);
	const eventType =
		resolution === "accepted"
			? "admin.member.added"
			: "admin.member.invitation_rejected";
	const result: OperationResult<OrganizationInvitation> = await db.transaction(
		async (transaction): Promise<OperationResult<OrganizationInvitation>> => {
			const references = await transaction
				.select({ organizationId: invitation.organizationId })
				.from(invitation)
				.where(eq(invitation.id, input.invitationId));
			const organizationId = references[0]?.organizationId;
			if (!organizationId) {
				return denied(
					transaction,
					input,
					undefined,
					input.invitationId,
					eventType,
					"NOT_FOUND",
					"Invitation was not found",
				);
			}
			const organizations = await transaction
				.select({ status: organization.status })
				.from(organization)
				.where(eq(organization.id, organizationId))
				.for("update");
			const actors = await transaction
				.select({
					id: user.id,
					email: user.email,
					emailVerified: user.emailVerified,
					banned: user.banned,
				})
				.from(user)
				.where(eq(user.id, input.actorUserId))
				.for("update");
			const actor = actors[0];
			if (!actor || actor.banned === true) {
				return denied(
					transaction,
					input,
					organizationId,
					input.invitationId,
					eventType,
					"POLICY_DENIED",
					"Invitation access is denied",
				);
			}
			const rows = await transaction
				.select()
				.from(invitation)
				.where(eq(invitation.id, input.invitationId))
				.for("update");
			const pending = rows[0];
			if (!pending || pending.organizationId !== organizationId) {
				return denied(
					transaction,
					input,
					organizationId,
					input.invitationId,
					eventType,
					"NOT_FOUND",
					"Invitation was not found",
				);
			}
			if (
				organizations[0]?.status !== "active" ||
				actor.emailVerified !== true ||
				actor.email.toLowerCase() !== pending.email.toLowerCase()
			) {
				return denied(
					transaction,
					input,
					organizationId,
					pending.id,
					eventType,
					"POLICY_DENIED",
					"Invitation access is denied",
				);
			}
			if (pending.status !== "pending") {
				return denied(
					transaction,
					input,
					organizationId,
					pending.id,
					eventType,
					"CONFLICT",
					"Invitation is no longer pending",
				);
			}
			const now = new Date();
			if (pending.expiresAt <= now) {
				const [expired] = await transaction
					.update(invitation)
					.set({ status: "expired" })
					.where(
						and(
							eq(invitation.id, pending.id),
							eq(invitation.status, "pending"),
							lte(invitation.expiresAt, now),
						),
					)
					.returning({ id: invitation.id });
				if (!expired)
					return denied(
						transaction,
						input,
						organizationId,
						pending.id,
						eventType,
						"CONFLICT",
						"Invitation expiry lost its compare-and-swap",
					);
				await recordAdminAuditEvent(transaction, {
					eventType: "admin.member.invitation_expired",
					outcome: "success",
					reasonCode: "authorized",
					requestId: input.requestId,
					actorUserId: actor.id,
					targetUserId: actor.id,
					targetId: expired.id,
					organizationId,
					ipAddress: input.ipAddress,
				});
				return denied(
					transaction,
					input,
					organizationId,
					pending.id,
					eventType,
					"INVALID_INPUT",
					"Invitation has expired",
				);
			}
			if (resolution === "accepted") {
				const existing = await transaction
					.select({ id: member.id })
					.from(member)
					.where(
						and(
							eq(member.organizationId, organizationId),
							eq(member.userId, actor.id),
						),
					)
					.for("update");
				if (existing.length > 0) {
					return denied(
						transaction,
						input,
						organizationId,
						pending.id,
						eventType,
						"CONFLICT",
						"User is already an organization member",
					);
				}
				await transaction.insert(member).values({
					id: crypto.randomUUID(),
					organizationId,
					userId: actor.id,
					role: validateRole(pending.role ?? "user"),
					createdAt: new Date(),
				});
			}
			const [resolved] = await transaction
				.update(invitation)
				.set({ status: resolution })
				.where(
					and(eq(invitation.id, pending.id), eq(invitation.status, "pending")),
				)
				.returning();
			if (!resolved) {
				return denied(
					transaction,
					input,
					organizationId,
					pending.id,
					eventType,
					"CONFLICT",
					"Invitation resolution lost its compare-and-swap",
				);
			}
			await recordAdminAuditEvent(transaction, {
				eventType,
				outcome: "success",
				reasonCode: "authorized",
				requestId: input.requestId,
				actorUserId: actor.id,
				targetUserId: actor.id,
				targetId: resolved.id,
				organizationId,
				ipAddress: input.ipAddress,
				metadata: { invitation_resolution: resolution },
			});
			return { value: mapInvitation(resolved) };
		},
	);
	if (result.error) throw result.error;
	return result.value;
}

export function acceptOrganizationInvitation(
	input: ResolveOrganizationInvitationInput,
): Promise<OrganizationInvitation> {
	return resolveInvitation(input, "accepted");
}

export function rejectOrganizationInvitation(
	input: ResolveOrganizationInvitationInput,
): Promise<OrganizationInvitation> {
	return resolveInvitation(input, "rejected");
}
