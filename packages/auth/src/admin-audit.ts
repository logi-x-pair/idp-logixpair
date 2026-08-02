import { db } from "@krazil-idp/db";
import {
	adminAuditEvent,
	adminAuditOutbox,
} from "@krazil-idp/db/schema/admin-audit";
import { and, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";

export const ADMIN_AUDIT_EVENT_TYPES = [
	"admin.login.succeeded",
	"admin.login.failed",
	"admin.2fa.succeeded",
	"admin.2fa.failed",
	"admin.logout",
	"admin.user.created",
	"admin.user.profile_changed",
	"admin.user.banned",
	"admin.user.unbanned",
	"admin.user.deleted",
	"admin.platform_role.changed",
	"admin.organization.created",
	"admin.organization.updated",
	"admin.organization.suspended",
	"admin.organization.archived",
	"admin.member.invited",
	"admin.member.invitation_cancelled",
	"admin.member.invitation_expired",
	"admin.member.added",
	"admin.member.removed",
	"admin.member.role_changed",
	"admin.binding.created",
	"admin.binding.updated",
	"admin.binding.status_changed",
	"admin.binding.health_checked",
	"admin.audit.read",
	"admin.audit.retention_purged",
] as const;

export const ADMIN_AUDIT_REASON_CODES = [
	"authorized",
	"policy_denied",
	"invalid_input",
	"not_found",
	"conflict",
	"last_admin_protected",
	"sink_failure",
	"internal_error",
	"rollback",
] as const;

export type AdminAuditEventType = (typeof ADMIN_AUDIT_EVENT_TYPES)[number];
export type AdminAuditReasonCode = (typeof ADMIN_AUDIT_REASON_CODES)[number];
export type AdminAuditOutcome = "success" | "failure" | "denied";
export type AdminAuditMetadataValue = string | number | boolean | null;
export type AdminAuditMetadata = Record<string, AdminAuditMetadataValue>;

export interface AdminAuditEventInput {
	/** Optional server-generated idempotency key for retry-safe callers. */
	eventId?: string;
	eventType: AdminAuditEventType;
	outcome: AdminAuditOutcome;
	reasonCode: AdminAuditReasonCode;
	requestId: string;
	actorUserId?: string;
	targetUserId?: string;
	targetId?: string;
	organizationId?: string;
	ipAddress?: string;
	metadata?: AdminAuditMetadata;
	occurredAt?: Date;
}

export type AdminAuditPayload = Omit<
	AdminAuditEventInput,
	"occurredAt" | "eventId"
> & {
	eventId: string;
	occurredAt: string;
};

export type AuditExecutor = Pick<typeof db, "insert">;
export type AdminAuditSink = (payload: AdminAuditPayload) => Promise<void>;

const SAFE_METADATA_KEY = /^[a-z][a-z0-9_]{0,63}$/;
const FORBIDDEN_METADATA_KEY =
	/(password|secret|token|credential|connection|authorization|cookie|private|code)/i;

function validateMetadata(metadata: AdminAuditMetadata | undefined): void {
	if (!metadata) return;
	const entries = Object.entries(metadata);
	if (entries.length > 32) {
		throw new Error("admin audit metadata limit exceeded");
	}
	for (const [key, value] of entries) {
		if (!SAFE_METADATA_KEY.test(key) || FORBIDDEN_METADATA_KEY.test(key)) {
			throw new Error("admin audit metadata key is not allowlisted");
		}
		if (typeof value === "string" && value.length > 256) {
			throw new Error("admin audit metadata value is too long");
		}
		if (typeof value === "number" && !Number.isFinite(value)) {
			throw new Error("admin audit metadata number is invalid");
		}
	}
}

function validateEventInput(input: AdminAuditEventInput): void {
	if (!ADMIN_AUDIT_EVENT_TYPES.includes(input.eventType)) {
		throw new Error("admin audit event type is not allowlisted");
	}
	if (!ADMIN_AUDIT_REASON_CODES.includes(input.reasonCode)) {
		throw new Error("admin audit reason code is not allowlisted");
	}
	if (!input.requestId || input.requestId.length > 128) {
		throw new Error("admin audit request ID is invalid");
	}
	if (input.ipAddress && input.ipAddress.length > 128) {
		throw new Error("admin audit IP address is invalid");
	}
	validateMetadata(input.metadata);
}

function createAuditPayload(input: AdminAuditEventInput): AdminAuditPayload {
	validateEventInput(input);
	const occurredAt = input.occurredAt ?? new Date();
	return {
		eventId: input.eventId ?? crypto.randomUUID(),
		eventType: input.eventType,
		occurredAt: occurredAt.toISOString(),
		outcome: input.outcome,
		reasonCode: input.reasonCode,
		requestId: input.requestId,
		actorUserId: input.actorUserId,
		targetUserId: input.targetUserId,
		targetId: input.targetId,
		organizationId: input.organizationId,
		ipAddress: input.ipAddress,
		metadata: input.metadata,
	};
}

/**
 * Inserts the immutable audit event and its delivery outbox row through the
 * caller's transaction executor. The caller must invoke this before commit.
 */
export async function recordAdminAuditEvent(
	executor: AuditExecutor,
	input: AdminAuditEventInput,
): Promise<AdminAuditPayload> {
	const payload = createAuditPayload(input);
	await executor.insert(adminAuditEvent).values({
		eventId: payload.eventId,
		eventType: payload.eventType,
		occurredAt: new Date(payload.occurredAt),
		actorUserId: payload.actorUserId,
		targetUserId: payload.targetUserId,
		targetId: payload.targetId,
		organizationId: payload.organizationId,
		outcome: payload.outcome,
		reasonCode: payload.reasonCode,
		ipAddress: payload.ipAddress,
		requestId: payload.requestId,
		metadata: payload.metadata,
	});
	await executor.insert(adminAuditOutbox).values({
		outboxId: crypto.randomUUID(),
		auditEventId: payload.eventId,
		payload,
	});
	return payload;
}

export async function recordAdminAuditEventInTransaction(
	input: AdminAuditEventInput,
): Promise<AdminAuditPayload> {
	return db.transaction((transaction) =>
		recordAdminAuditEvent(transaction, input),
	);
}

/**
 * Claims a bounded batch and delivers it outside the claim transaction. A
 * failed sink never removes the event; it records a safe retry marker and an
 * exponential backoff. An expired processing lease is claimable again.
 */
export async function deliverAdminAuditOutbox(
	sink: AdminAuditSink,
	options: {
		limit?: number;
		leaseSeconds?: number;
		now?: Date;
		auditEventId?: string;
	} = {},
): Promise<{ claimed: number; delivered: number; failed: number }> {
	const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
	const leaseSeconds = Math.min(
		Math.max(options.leaseSeconds ?? 300, 30),
		3600,
	);
	const now = options.now ?? new Date();
	const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000);
	const claimable = or(
		and(
			inArray(adminAuditOutbox.status, ["pending", "failed"]),
			lte(adminAuditOutbox.nextAttemptAt, now),
		),
		and(
			eq(adminAuditOutbox.status, "processing"),
			or(
				isNull(adminAuditOutbox.leaseUntil),
				lt(adminAuditOutbox.leaseUntil, now),
			),
		),
	);
	const claimedRows = await db.transaction(async (transaction) => {
		const rows = await transaction
			.select()
			.from(adminAuditOutbox)
			.where(
				options.auditEventId
					? and(
							claimable,
							eq(adminAuditOutbox.auditEventId, options.auditEventId),
						)
					: claimable,
			)
			.limit(limit)
			.for("update", { skipLocked: true });
		for (const row of rows) {
			await transaction
				.update(adminAuditOutbox)
				.set({
					status: "processing",
					attempts: sql`${adminAuditOutbox.attempts} + 1`,
					leaseUntil,
					updatedAt: now,
				})
				.where(eq(adminAuditOutbox.outboxId, row.outboxId));
		}
		return rows;
	});

	let delivered = 0;
	let failed = 0;
	for (const row of claimedRows) {
		const payload = row.payload as AdminAuditPayload;
		try {
			await sink(payload);
			await db
				.update(adminAuditOutbox)
				.set({
					status: "delivered",
					deliveredAt: new Date(),
					leaseUntil: null,
					lastErrorCode: null,
				})
				.where(eq(adminAuditOutbox.outboxId, row.outboxId));
			delivered++;
		} catch {
			const retrySeconds = Math.min(3600, 5 * 2 ** Math.min(row.attempts, 9));
			await db
				.update(adminAuditOutbox)
				.set({
					status: "failed",
					nextAttemptAt: new Date(Date.now() + retrySeconds * 1000),
					leaseUntil: null,
					lastErrorCode: "SINK_REJECTED",
				})
				.where(eq(adminAuditOutbox.outboxId, row.outboxId));
			console.error(
				JSON.stringify({
					audit: true,
					event: "admin.audit_sink_failure",
					outboxId: row.outboxId,
					retrySeconds,
				}),
			);
			failed++;
		}
	}
	return { claimed: claimedRows.length, delivered, failed };
}
