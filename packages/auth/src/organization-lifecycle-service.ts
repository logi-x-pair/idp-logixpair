import { db } from "@krazil-idp/db";
import { organization } from "@krazil-idp/db/schema/organization";
import { and, eq } from "drizzle-orm";

import { recordAdminAuditEvent } from "./admin-audit";
import {
	OrganizationPolicyError,
	type OrganizationPolicyErrorCode,
	type OrganizationStatus,
} from "./organization-policy";
import {
	isActivePolicyActor,
	lockPlatformInvariant,
	lockUsers,
	type PolicyTransaction,
} from "./platform-policy";

export type OrganizationDisplayMetadataValue = string | number | boolean | null;
export type OrganizationDisplayMetadata = Record<
	string,
	OrganizationDisplayMetadataValue
>;

export interface OrganizationLifecycleContext {
	actorUserId: string;
	requestId: string;
	ipAddress?: string;
}

export interface CreateOrganizationInput extends OrganizationLifecycleContext {
	initialAdminUserId: string;
	name: string;
	slug: string;
	logo?: string | null;
	metadata?: OrganizationDisplayMetadata;
}

export interface UpdateOrganizationProfileInput
	extends OrganizationLifecycleContext {
	organizationId: string;
	name?: string;
	slug?: string;
	logo?: string | null;
	metadata?: OrganizationDisplayMetadata;
}

export interface ChangeOrganizationStatusInput
	extends OrganizationLifecycleContext {
	organizationId: string;
	expectedStatus: OrganizationStatus;
	requestedStatus: OrganizationStatus;
}

export interface OrganizationProfile {
	id: string;
	name: string;
	slug: string;
	logo: string | null;
	status: OrganizationStatus;
	metadata: OrganizationDisplayMetadata | null;
}

type OperationResult<T> =
	| { value: T; error?: never }
	| { value?: never; error: OrganizationPolicyError };

type OrganizationEventType =
	| "admin.organization.created"
	| "admin.organization.updated"
	| "admin.organization.suspended"
	| "admin.organization.archived";

function error(
	code: OrganizationPolicyErrorCode,
	message: string,
): OrganizationPolicyError {
	return new OrganizationPolicyError(code, message);
}

function validateContext(input: OrganizationLifecycleContext): void {
	if (!input.actorUserId || !input.requestId || input.requestId.length > 128) {
		throw error("INVALID_INPUT", "Organization request context is invalid");
	}
}

async function decision<T>(
	transaction: PolicyTransaction,
	input: OrganizationLifecycleContext,
	eventType: OrganizationEventType,
	organizationId: string | undefined,
	code: Exclude<OrganizationPolicyErrorCode, "LAST_ADMIN_PROTECTED">,
	message: string,
): Promise<OperationResult<T>> {
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
		targetId: organizationId,
		ipAddress: input.ipAddress,
	});
	return { error: error(code, message) };
}

async function success(
	transaction: PolicyTransaction,
	input: OrganizationLifecycleContext,
	eventType: OrganizationEventType,
	organizationId: string,
	metadata?: Record<string, string | number | boolean | null>,
): Promise<void> {
	await recordAdminAuditEvent(transaction, {
		eventType,
		outcome: "success",
		reasonCode: "authorized",
		requestId: input.requestId,
		actorUserId: input.actorUserId,
		organizationId,
		targetId: organizationId,
		ipAddress: input.ipAddress,
		metadata,
	});
}

function parseMetadata(
	value: string | null,
): OrganizationDisplayMetadata | null {
	if (!value) return null;
	const parsed = JSON.parse(value) as unknown;
	return parsed && typeof parsed === "object" && !Array.isArray(parsed)
		? (parsed as OrganizationDisplayMetadata)
		: null;
}

function profile(row: typeof organization.$inferSelect): OrganizationProfile {
	return {
		id: row.id,
		name: row.name,
		slug: row.slug,
		logo: row.logo,
		status: row.status as OrganizationStatus,
		metadata: parseMetadata(row.metadata),
	};
}

function unwrap<T>(result: OperationResult<T>): T {
	if (result.error) throw result.error;
	return result.value;
}

export async function changeOrganizationStatus(
	input: ChangeOrganizationStatusInput,
): Promise<OrganizationProfile> {
	validateContext(input);
	if (
		input.requestedStatus === input.expectedStatus ||
		input.expectedStatus === "archived"
	) {
		throw error("INVALID_INPUT", "Organization status transition is invalid");
	}
	const result: OperationResult<OrganizationProfile> = await db.transaction(
		async (transaction): Promise<OperationResult<OrganizationProfile>> => {
			await lockPlatformInvariant(transaction);
			const rows = await transaction
				.select()
				.from(organization)
				.where(eq(organization.id, input.organizationId))
				.for("update");
			const current = rows[0];
			const actor = (await lockUsers(transaction, [input.actorUserId]))[0];
			if (!actor || !current)
				return decision(
					transaction,
					input,
					"admin.organization.updated",
					input.organizationId,
					"NOT_FOUND",
					"Actor or organization was not found",
				);
			if (!isActivePolicyActor(actor) || actor.role !== "admin")
				return decision(
					transaction,
					input,
					"admin.organization.updated",
					current.id,
					"POLICY_DENIED",
					"Platform admin authorization is required",
				);
			if (current.status !== input.expectedStatus)
				return decision(
					transaction,
					input,
					"admin.organization.updated",
					current.id,
					"CONFLICT",
					"Organization status is stale",
				);
			const eventType: OrganizationEventType =
				input.requestedStatus === "suspended"
					? "admin.organization.suspended"
					: input.requestedStatus === "archived"
						? "admin.organization.archived"
						: "admin.organization.updated";
			const [updated] = await transaction
				.update(organization)
				.set({ status: input.requestedStatus })
				.where(
					and(
						eq(organization.id, current.id),
						eq(organization.status, input.expectedStatus),
					),
				)
				.returning();
			if (!updated)
				return decision(
					transaction,
					input,
					eventType,
					current.id,
					"CONFLICT",
					"Organization status update lost its compare-and-swap",
				);
			await success(transaction, input, eventType, updated.id, {
				previous_status: input.expectedStatus,
				requested_status: input.requestedStatus,
			});
			return { value: profile(updated) };
		},
	);
	return unwrap(result);
}
