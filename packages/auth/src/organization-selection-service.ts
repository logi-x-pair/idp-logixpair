import { db } from "@krazil-idp/db";
import { session, user } from "@krazil-idp/db/schema/auth";
import { member, organization } from "@krazil-idp/db/schema/organization";
import { and, eq, gt } from "drizzle-orm";

import { recordAdminAuditEvent } from "./admin-audit";
import {
	OrganizationPolicyError,
	organizationPolicyReasonCode as reasonCodeFor,
} from "./organization-policy";
import type { PolicyTransaction } from "./platform-policy";

export interface SetActiveOrganizationInput {
	actorUserId: string;
	sessionId: string;
	organizationId: string;
	requestId: string;
	ipAddress?: string;
}

type SelectionErrorCode = "NOT_FOUND" | "POLICY_DENIED" | "CONFLICT";

function selectionError(code: SelectionErrorCode, message: string) {
	return new OrganizationPolicyError(code, message);
}

async function denySelection(
	transaction: PolicyTransaction,
	input: SetActiveOrganizationInput,
	code: SelectionErrorCode,
	message: string,
): Promise<{ error: OrganizationPolicyError }> {
	await recordAdminAuditEvent(transaction, {
		eventType: "admin.organization.activated",
		outcome: "denied",
		reasonCode: reasonCodeFor(code),
		requestId: input.requestId,
		actorUserId: input.actorUserId,
		organizationId: input.organizationId,
		targetId: input.organizationId,
		ipAddress: input.ipAddress,
	});
	return { error: selectionError(code, message) };
}

export async function setActiveOrganization(
	input: SetActiveOrganizationInput,
): Promise<void> {
	if (
		!input.actorUserId ||
		!input.sessionId ||
		!input.organizationId ||
		!input.requestId ||
		input.requestId.length > 128
	) {
		throw selectionError("POLICY_DENIED", "Organization selection is invalid");
	}

	const result = await db.transaction(async (transaction) => {
		const organizations = await transaction
			.select({ id: organization.id, status: organization.status })
			.from(organization)
			.where(eq(organization.id, input.organizationId))
			.for("update");
		const selectedOrganization = organizations[0];
		if (!selectedOrganization) {
			return denySelection(
				transaction,
				input,
				"NOT_FOUND",
				"Organization was not found",
			);
		}
		if (selectedOrganization.status !== "active") {
			return denySelection(
				transaction,
				input,
				"POLICY_DENIED",
				"Organization selection is denied",
			);
		}

		const actors = await transaction
			.select({ id: user.id, banned: user.banned })
			.from(user)
			.where(eq(user.id, input.actorUserId))
			.for("update");
		if (!actors[0] || actors[0].banned === true) {
			return denySelection(
				transaction,
				input,
				"POLICY_DENIED",
				"Organization selection is denied",
			);
		}

		const memberships = await transaction
			.select({ id: member.id })
			.from(member)
			.where(
				and(
					eq(member.organizationId, selectedOrganization.id),
					eq(member.userId, input.actorUserId),
				),
			)
			.for("update");
		if (!memberships[0]) {
			return denySelection(
				transaction,
				input,
				"POLICY_DENIED",
				"Organization selection is denied",
			);
		}

		const [updatedSession] = await transaction
			.update(session)
			.set({ activeOrganizationId: selectedOrganization.id })
			.where(
				and(
					eq(session.id, input.sessionId),
					eq(session.userId, input.actorUserId),
					gt(session.expiresAt, new Date()),
				),
			)
			.returning({ id: session.id });
		if (!updatedSession) {
			return denySelection(
				transaction,
				input,
				"CONFLICT",
				"Session is no longer active",
			);
		}

		await recordAdminAuditEvent(transaction, {
			eventType: "admin.organization.activated",
			outcome: "success",
			reasonCode: "authorized",
			requestId: input.requestId,
			actorUserId: input.actorUserId,
			organizationId: selectedOrganization.id,
			targetId: selectedOrganization.id,
			ipAddress: input.ipAddress,
		});
		return { value: undefined };
	});

	if ("error" in result) throw result.error;
}
