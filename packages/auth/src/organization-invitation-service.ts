import { db } from "@krazil-idp/db";
import { user } from "@krazil-idp/db/schema/auth";
import {
	invitation,
	member,
	organization,
} from "@krazil-idp/db/schema/organization";
import { and, eq, gt, lte, sql } from "drizzle-orm";
import { z } from "zod";

import { recordAdminAuditEvent } from "./admin-audit";
import type {
	CancelOrganizationInvitationInput,
	InviteOrganizationMemberInput,
	OrganizationInvitationOperationResult as OperationResult,
	OrganizationInvitation,
} from "./organization-invitation-policy";
import {
	denyOrganizationInvitation as denied,
	organizationInvitationError as error,
	mapOrganizationInvitation as mapInvitation,
	validateInvitationRequest as validateRequest,
} from "./organization-invitation-policy";
import {
	organizationMemberHasRole as hasRole,
	validateOrganizationPolicyRole as validateRole,
} from "./organization-policy";
import type { PolicyTransaction } from "./platform-policy";

export type {
	CancelOrganizationInvitationInput,
	InvitationContext,
	InviteOrganizationMemberInput,
	OrganizationInvitation,
	ResolveOrganizationInvitationInput,
} from "./organization-invitation-policy";

const emailSchema = z
	.email()
	.max(254)
	.transform((email) => email.toLowerCase());
const DEFAULT_INVITATION_SECONDS = 48 * 60 * 60;
const MIN_INVITATION_SECONDS = 5 * 60;
const MAX_INVITATION_SECONDS = 30 * 24 * 60 * 60;
const MAX_PENDING_INVITATIONS = 100;

interface InvitationActorContext {
	user: { id: string; role: string; banned: boolean | null };
	membership?: { id: string; role: string };
}

async function lockActor(
	transaction: PolicyTransaction,
	actorUserId: string,
	organizationId: string,
): Promise<InvitationActorContext | undefined> {
	const users = await transaction
		.select({ id: user.id, role: user.role, banned: user.banned })
		.from(user)
		.where(eq(user.id, actorUserId))
		.for("update");
	const actor = users[0];
	if (!actor) return undefined;
	const memberships = await transaction
		.select({ id: member.id, role: member.role })
		.from(member)
		.where(
			and(
				eq(member.organizationId, organizationId),
				eq(member.userId, actorUserId),
			),
		)
		.for("update");
	return { user: actor, membership: memberships[0] };
}

function isOrganizationAdmin(
	context: InvitationActorContext | undefined,
): boolean {
	if (!context || context.user.banned === true) return false;
	if (context.user.role === "admin") return true;
	if (!context.membership) return false;
	return hasRole(
		{
			id: context.membership.id,
			userId: context.user.id,
			organizationId: "",
			role: context.membership.role,
		},
		"admin",
	);
}

export async function inviteOrganizationMember(
	input: InviteOrganizationMemberInput,
): Promise<OrganizationInvitation> {
	validateRequest(input);
	const email = emailSchema.parse(input.email);
	const role = validateRole(input.role);
	const expiresInSeconds = input.expiresInSeconds ?? DEFAULT_INVITATION_SECONDS;
	if (
		!Number.isInteger(expiresInSeconds) ||
		expiresInSeconds < MIN_INVITATION_SECONDS ||
		expiresInSeconds > MAX_INVITATION_SECONDS
	) {
		throw error("INVALID_INPUT", "Invitation expiry is invalid");
	}
	const result: OperationResult<OrganizationInvitation> = await db.transaction(
		async (transaction): Promise<OperationResult<OrganizationInvitation>> => {
			const organizations = await transaction
				.select({ id: organization.id, status: organization.status })
				.from(organization)
				.where(eq(organization.id, input.organizationId))
				.for("update");
			const current = organizations[0];
			if (!current)
				return denied(
					transaction,
					input,
					input.organizationId,
					undefined,
					"admin.member.invited",
					"NOT_FOUND",
					"Organization was not found",
				);
			const actor = await lockActor(transaction, input.actorUserId, current.id);
			if (current.status !== "active" || !isOrganizationAdmin(actor))
				return denied(
					transaction,
					input,
					current.id,
					undefined,
					"admin.member.invited",
					"POLICY_DENIED",
					"Only an active organization admin may invite members",
				);
			const existingMembers = await transaction
				.select({ id: member.id })
				.from(member)
				.innerJoin(user, eq(member.userId, user.id))
				.where(
					and(eq(member.organizationId, current.id), eq(user.email, email)),
				);
			if (existingMembers.length > 0)
				return denied(
					transaction,
					input,
					current.id,
					undefined,
					"admin.member.invited",
					"CONFLICT",
					"Email already belongs to an organization member",
				);
			const now = new Date();
			const pending = await transaction
				.select({ id: invitation.id, expiresAt: invitation.expiresAt })
				.from(invitation)
				.where(
					and(
						eq(invitation.organizationId, current.id),
						eq(invitation.email, email),
						eq(invitation.status, "pending"),
					),
				)
				.for("update");
			const existingPending = pending[0];
			if (existingPending?.expiresAt && existingPending.expiresAt > now)
				return denied(
					transaction,
					input,
					current.id,
					existingPending.id,
					"admin.member.invited",
					"CONFLICT",
					"A pending invitation already exists",
				);
			if (existingPending) {
				const [expired] = await transaction
					.update(invitation)
					.set({ status: "expired" })
					.where(
						and(
							eq(invitation.id, existingPending.id),
							eq(invitation.status, "pending"),
							lte(invitation.expiresAt, now),
						),
					)
					.returning({ id: invitation.id });
				if (!expired)
					return denied(
						transaction,
						input,
						current.id,
						existingPending.id,
						"admin.member.invited",
						"CONFLICT",
						"Invitation expiry lost its compare-and-swap",
					);
				await recordAdminAuditEvent(transaction, {
					eventType: "admin.member.invitation_expired",
					outcome: "success",
					reasonCode: "authorized",
					requestId: input.requestId,
					actorUserId: input.actorUserId,
					targetId: expired.id,
					organizationId: current.id,
					ipAddress: input.ipAddress,
				});
			}
			const pendingTotals = await transaction
				.select({ count: sql<number>`count(*)::int` })
				.from(invitation)
				.where(
					and(
						eq(invitation.organizationId, current.id),
						eq(invitation.status, "pending"),
						gt(invitation.expiresAt, now),
					),
				);
			if ((pendingTotals[0]?.count ?? 0) >= MAX_PENDING_INVITATIONS)
				return denied(
					transaction,
					input,
					current.id,
					undefined,
					"admin.member.invited",
					"CONFLICT",
					"Organization pending invitation limit has been reached",
				);
			const [created] = await transaction
				.insert(invitation)
				.values({
					id: crypto.randomUUID(),
					organizationId: current.id,
					email,
					role,
					status: "pending",
					expiresAt: new Date(now.getTime() + expiresInSeconds * 1000),
					createdAt: now,
					inviterId: input.actorUserId,
				})
				.returning();
			if (!created) throw error("CONFLICT", "Invitation could not be created");
			await recordAdminAuditEvent(transaction, {
				eventType: "admin.member.invited",
				outcome: "success",
				reasonCode: "authorized",
				requestId: input.requestId,
				actorUserId: input.actorUserId,
				targetId: created.id,
				organizationId: current.id,
				ipAddress: input.ipAddress,
				metadata: { invited_role: role },
			});
			return { value: mapInvitation(created) };
		},
	);
	if (result.error) throw result.error;
	return result.value;
}

export async function cancelOrganizationInvitation(
	input: CancelOrganizationInvitationInput,
): Promise<OrganizationInvitation> {
	validateRequest(input);
	const result: OperationResult<OrganizationInvitation> = await db.transaction(
		async (transaction): Promise<OperationResult<OrganizationInvitation>> => {
			const organizations = await transaction
				.select({ id: organization.id, status: organization.status })
				.from(organization)
				.where(eq(organization.id, input.organizationId))
				.for("update");
			const current = organizations[0];
			if (!current)
				return denied(
					transaction,
					input,
					input.organizationId,
					input.invitationId,
					"admin.member.invitation_cancelled",
					"NOT_FOUND",
					"Organization was not found",
				);
			const actor = await lockActor(transaction, input.actorUserId, current.id);
			if (current.status !== "active" || !isOrganizationAdmin(actor))
				return denied(
					transaction,
					input,
					current.id,
					input.invitationId,
					"admin.member.invitation_cancelled",
					"POLICY_DENIED",
					"Only an active organization admin may cancel invitations",
				);
			const rows = await transaction
				.select()
				.from(invitation)
				.where(
					and(
						eq(invitation.id, input.invitationId),
						eq(invitation.organizationId, current.id),
					),
				)
				.for("update");
			const pending = rows[0];
			if (!pending)
				return denied(
					transaction,
					input,
					current.id,
					input.invitationId,
					"admin.member.invitation_cancelled",
					"NOT_FOUND",
					"Invitation was not found",
				);
			if (pending.status !== "pending")
				return denied(
					transaction,
					input,
					current.id,
					pending.id,
					"admin.member.invitation_cancelled",
					"CONFLICT",
					"Invitation is no longer pending",
				);
			const [cancelled] = await transaction
				.update(invitation)
				.set({ status: "cancelled" })
				.where(
					and(eq(invitation.id, pending.id), eq(invitation.status, "pending")),
				)
				.returning();
			if (!cancelled)
				return denied(
					transaction,
					input,
					current.id,
					pending.id,
					"admin.member.invitation_cancelled",
					"CONFLICT",
					"Invitation cancellation lost its compare-and-swap",
				);
			await recordAdminAuditEvent(transaction, {
				eventType: "admin.member.invitation_cancelled",
				outcome: "success",
				reasonCode: "authorized",
				requestId: input.requestId,
				actorUserId: input.actorUserId,
				targetId: cancelled.id,
				organizationId: current.id,
				ipAddress: input.ipAddress,
			});
			return { value: mapInvitation(cancelled) };
		},
	);
	if (result.error) throw result.error;
	return result.value;
}

export {
	acceptOrganizationInvitation,
	rejectOrganizationInvitation,
} from "./organization-invitation-resolution-service";
