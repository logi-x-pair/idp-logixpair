import { db } from "@krazil-idp/db";
import { adminAuditEvent } from "@krazil-idp/db/schema/admin-audit";
import { user } from "@krazil-idp/db/schema/auth";
import { member, organization } from "@krazil-idp/db/schema/organization";
import { and, desc, eq, gte, inArray, lt, lte, or } from "drizzle-orm";

import {
	ADMIN_AUDIT_EVENT_TYPES,
	type AdminAuditEventType,
	type AdminAuditMetadata,
	recordAdminAuditEvent,
} from "./admin-audit";
import { organizationMemberHasRole as hasRole } from "./organization-policy";
import { PlatformPolicyError, type PolicyTransaction } from "./platform-policy";

const ORGANIZATION_AUDIT_EVENT_TYPES = ADMIN_AUDIT_EVENT_TYPES.filter(
	(eventType) =>
		eventType.startsWith("admin.organization.") ||
		eventType.startsWith("admin.member."),
);

export interface AdminAuditReadCursor {
	occurredAt: Date;
	eventId: string;
}

export interface AdminAuditReadInput {
	actorUserId: string;
	requestId: string;
	organizationId?: string;
	eventTypes?: AdminAuditEventType[];
	outcome?: "success" | "failure" | "denied";
	targetUserId?: string;
	requestIdFilter?: string;
	from?: Date;
	to?: Date;
	cursor?: AdminAuditReadCursor;
	pageSize?: number;
}

export interface AdminAuditReadEvent {
	eventId: string;
	eventType: AdminAuditEventType;
	occurredAt: Date;
	actorUserId: string | null;
	targetUserId: string | null;
	targetId: string | null;
	organizationId: string | null;
	outcome: "success" | "failure" | "denied";
	reasonCode: string;
	requestId: string;
	metadata: AdminAuditMetadata | null;
}

export interface AdminAuditReadPage {
	items: AdminAuditReadEvent[];
	pageSize: number;
	nextCursor?: AdminAuditReadCursor;
}

type AuditReadScope =
	| { kind: "platform" }
	| { kind: "organization"; organizationId: string };

function validateInput(input: AdminAuditReadInput): { pageSize: number } {
	if (!input.actorUserId || !input.requestId || input.requestId.length > 128) {
		throw new PlatformPolicyError(
			"INVALID_INPUT",
			"Audit read context is invalid",
		);
	}
	const pageSize = input.pageSize ?? 50;
	if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
		throw new PlatformPolicyError(
			"INVALID_INPUT",
			"Audit page size is invalid",
		);
	}
	if (
		input.cursor &&
		(!(input.cursor.occurredAt instanceof Date) ||
			Number.isNaN(input.cursor.occurredAt.getTime()) ||
			!input.cursor.eventId.trim() ||
			input.cursor.eventId.length > 128)
	) {
		throw new PlatformPolicyError("INVALID_INPUT", "Audit cursor is invalid");
	}
	for (const date of [input.from, input.to]) {
		if (date && (!(date instanceof Date) || Number.isNaN(date.getTime()))) {
			throw new PlatformPolicyError(
				"INVALID_INPUT",
				"Audit time range is invalid",
			);
		}
	}
	if (input.from && input.to && input.from > input.to) {
		throw new PlatformPolicyError(
			"INVALID_INPUT",
			"Audit time range is invalid",
		);
	}
	return { pageSize };
}

async function resolveScope(
	transaction: PolicyTransaction,
	input: AdminAuditReadInput,
): Promise<AuditReadScope | undefined> {
	let organizationStatus: string | undefined;
	if (input.organizationId) {
		const organizations = await transaction
			.select({ id: organization.id, status: organization.status })
			.from(organization)
			.where(eq(organization.id, input.organizationId))
			.for("share");
		organizationStatus = organizations[0]?.status;
	}
	const actors = await transaction
		.select({ id: user.id, role: user.role, banned: user.banned })
		.from(user)
		.where(eq(user.id, input.actorUserId))
		.for("share");
	const actor = actors[0];
	if (!actor || actor.banned === true) return undefined;
	if (actor.role === "admin") return { kind: "platform" };
	if (!input.organizationId) return undefined;
	if (organizationStatus !== "active") return undefined;
	const memberships = await transaction
		.select({ id: member.id, role: member.role })
		.from(member)
		.where(
			and(
				eq(member.organizationId, input.organizationId),
				eq(member.userId, actor.id),
			),
		)
		.for("share");
	const membership = memberships[0];
	if (!membership) return undefined;
	const mayRead = hasRole(
		{
			id: membership.id,
			userId: actor.id,
			organizationId: input.organizationId,
			role: membership.role,
		},
		"admin",
	);
	return mayRead
		? { kind: "organization", organizationId: input.organizationId }
		: undefined;
}

function buildConditions(input: AdminAuditReadInput, scope: AuditReadScope) {
	const conditions = [];
	if (scope.kind === "organization") {
		conditions.push(eq(adminAuditEvent.organizationId, scope.organizationId));
		conditions.push(
			inArray(adminAuditEvent.eventType, ORGANIZATION_AUDIT_EVENT_TYPES),
		);
	} else if (input.organizationId) {
		conditions.push(eq(adminAuditEvent.organizationId, input.organizationId));
	}
	if (input.eventTypes?.length) {
		conditions.push(inArray(adminAuditEvent.eventType, input.eventTypes));
	}
	if (input.outcome)
		conditions.push(eq(adminAuditEvent.outcome, input.outcome));
	if (input.targetUserId) {
		conditions.push(eq(adminAuditEvent.targetUserId, input.targetUserId));
	}
	if (input.requestIdFilter) {
		conditions.push(eq(adminAuditEvent.requestId, input.requestIdFilter));
	}
	if (input.from) conditions.push(gte(adminAuditEvent.occurredAt, input.from));
	if (input.to) conditions.push(lte(adminAuditEvent.occurredAt, input.to));
	if (input.cursor) {
		const cursorCondition = or(
			lt(adminAuditEvent.occurredAt, input.cursor.occurredAt),
			and(
				eq(adminAuditEvent.occurredAt, input.cursor.occurredAt),
				lt(adminAuditEvent.eventId, input.cursor.eventId),
			),
		);
		if (cursorCondition) conditions.push(cursorCondition);
	}
	return conditions.length === 0 ? undefined : and(...conditions);
}

function parseMetadata(value: unknown): AdminAuditMetadata | null {
	let candidate = value;
	if (typeof candidate === "string") {
		try {
			candidate = JSON.parse(candidate);
		} catch {
			return null;
		}
	}
	if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
		return null;
	}
	const entries = Object.entries(candidate);
	const valid = entries.every(([key, item]) => {
		const validKey = /^[a-z][a-z0-9_]{0,63}$/.test(key);
		const validValue =
			item === null ||
			typeof item === "string" ||
			typeof item === "boolean" ||
			(typeof item === "number" && Number.isFinite(item));
		return validKey && validValue;
	});
	return valid ? (candidate as AdminAuditMetadata) : null;
}

async function recordReadAttempt(
	transaction: PolicyTransaction,
	input: AdminAuditReadInput,
	outcome: "success" | "denied",
	metadata?: AdminAuditMetadata,
): Promise<void> {
	await recordAdminAuditEvent(transaction, {
		eventType: "admin.audit.read",
		outcome,
		reasonCode: outcome === "success" ? "authorized" : "policy_denied",
		requestId: input.requestId,
		actorUserId: input.actorUserId,
		organizationId: input.organizationId,
		metadata,
	});
}

type AdminAuditReadResult =
	| { value: AdminAuditReadPage; error?: never }
	| { value?: never; error: PlatformPolicyError };

export async function readAdminAuditEvents(
	input: AdminAuditReadInput,
): Promise<AdminAuditReadPage> {
	const { pageSize } = validateInput(input);
	const result: AdminAuditReadResult = await db.transaction(
		async (transaction): Promise<AdminAuditReadResult> => {
			const scope = await resolveScope(transaction, input);
			if (!scope) {
				await recordReadAttempt(transaction, input, "denied");
				return {
					error: new PlatformPolicyError(
						"POLICY_DENIED",
						"Audit access is denied",
					),
				};
			}
			const where = buildConditions(input, scope);
			const rows = await transaction
				.select()
				.from(adminAuditEvent)
				.where(where)
				.orderBy(
					desc(adminAuditEvent.occurredAt),
					desc(adminAuditEvent.eventId),
				)
				.limit(pageSize + 1);
			const hasMore = rows.length > pageSize;
			const items = rows.slice(0, pageSize).map(
				(row): AdminAuditReadEvent => ({
					eventId: row.eventId,
					eventType: row.eventType as AdminAuditEventType,
					occurredAt: row.occurredAt,
					actorUserId: row.actorUserId,
					targetUserId: row.targetUserId,
					targetId: row.targetId,
					organizationId: row.organizationId,
					outcome: row.outcome as AdminAuditReadEvent["outcome"],
					reasonCode: row.reasonCode,
					requestId: row.requestId,
					metadata: parseMetadata(row.metadata),
				}),
			);
			const lastItem = items.at(-1);
			const nextCursor =
				hasMore && lastItem
					? { occurredAt: lastItem.occurredAt, eventId: lastItem.eventId }
					: undefined;
			await recordReadAttempt(transaction, input, "success", {
				has_more: hasMore,
				result_count: items.length,
				scope: scope.kind,
			});
			return { value: { items, pageSize, nextCursor } };
		},
	);
	if (result.error) throw result.error;
	return result.value;
}
