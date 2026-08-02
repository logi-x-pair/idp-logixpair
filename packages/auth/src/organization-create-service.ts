import { db } from "@krazil-idp/db";
import { member, organization } from "@krazil-idp/db/schema/organization";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { recordAdminAuditEvent } from "./admin-audit";
import type {
	CreateOrganizationInput,
	OrganizationDisplayMetadata,
	OrganizationProfile,
} from "./organization-lifecycle-service";
import {
	OrganizationPolicyError,
	type OrganizationPolicyErrorCode,
} from "./organization-policy";
import {
	findLockedUser,
	isActivePolicyActor,
	lockPlatformInvariant,
	lockUsers,
	type PolicyTransaction,
} from "./platform-policy";

const nameSchema = z.string().trim().min(1).max(120);
const slugSchema = z
	.string()
	.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
	.max(63);
const logoSchema = z.url().max(2048).nullable();
const forbiddenMetadataKey =
	/(password|secret|token|credential|connection|authorization|cookie|private|code)/i;

type OperationResult<T> =
	| { value: T; error?: never }
	| { value?: never; error: OrganizationPolicyError };

function error(
	code: OrganizationPolicyErrorCode,
	message: string,
): OrganizationPolicyError {
	return new OrganizationPolicyError(code, message);
}

function serializeMetadata(
	metadata: OrganizationDisplayMetadata | undefined,
): string | undefined {
	if (metadata === undefined) return undefined;
	const entries = Object.entries(metadata);
	if (entries.length > 32)
		throw error("INVALID_INPUT", "Organization metadata limit exceeded");
	for (const [key, value] of entries) {
		if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || forbiddenMetadataKey.test(key)) {
			throw error("INVALID_INPUT", "Organization metadata key is invalid");
		}
		if (typeof value === "string" && value.length > 256)
			throw error("INVALID_INPUT", "Organization metadata value is too long");
		if (typeof value === "number" && !Number.isFinite(value))
			throw error("INVALID_INPUT", "Organization metadata value is invalid");
	}
	const serialized = JSON.stringify(metadata);
	if (serialized.length > 4096)
		throw error("INVALID_INPUT", "Organization metadata is too large");
	return serialized;
}

function profile(row: typeof organization.$inferSelect): OrganizationProfile {
	let metadata: OrganizationDisplayMetadata | null = null;
	if (row.metadata) {
		const parsed = JSON.parse(row.metadata) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
			metadata = parsed as OrganizationDisplayMetadata;
	}
	return {
		id: row.id,
		name: row.name,
		slug: row.slug,
		logo: row.logo,
		status: row.status as OrganizationProfile["status"],
		metadata,
	};
}

async function denied<T>(
	transaction: PolicyTransaction,
	input: CreateOrganizationInput,
	organizationId: string | undefined,
	code: "POLICY_DENIED" | "CONFLICT" | "NOT_FOUND",
	message: string,
): Promise<OperationResult<T>> {
	await recordAdminAuditEvent(transaction, {
		eventType: "admin.organization.created",
		outcome: "denied",
		reasonCode:
			code === "POLICY_DENIED"
				? "policy_denied"
				: code === "CONFLICT"
					? "conflict"
					: "not_found",
		requestId: input.requestId,
		actorUserId: input.actorUserId,
		organizationId,
		targetId: organizationId,
		ipAddress: input.ipAddress,
	});
	return { error: error(code, message) };
}

export async function createOrganization(
	input: CreateOrganizationInput,
): Promise<OrganizationProfile> {
	if (!input.actorUserId || !input.requestId || input.requestId.length > 128)
		throw error("INVALID_INPUT", "Organization request context is invalid");
	const name = nameSchema.parse(input.name);
	const slug = slugSchema.parse(input.slug);
	const logo = input.logo === undefined ? null : logoSchema.parse(input.logo);
	const metadata = serializeMetadata(input.metadata);
	const result: OperationResult<OrganizationProfile> = await db.transaction(
		async (transaction): Promise<OperationResult<OrganizationProfile>> => {
			await lockPlatformInvariant(transaction);
			const users = await lockUsers(transaction, [
				input.actorUserId,
				input.initialAdminUserId,
			]);
			const actor = findLockedUser(users, input.actorUserId);
			const initialAdmin = findLockedUser(users, input.initialAdminUserId);
			if (
				!actor ||
				!initialAdmin ||
				!isActivePolicyActor(actor) ||
				!isActivePolicyActor(initialAdmin) ||
				actor.role !== "admin"
			) {
				return denied(
					transaction,
					input,
					undefined,
					"POLICY_DENIED",
					"Platform admin authorization is required",
				);
			}
			const conflicts = await transaction
				.select({ id: organization.id })
				.from(organization)
				.where(eq(organization.slug, slug));
			if (conflicts.length > 0)
				return denied(
					transaction,
					input,
					conflicts[0]?.id,
					"CONFLICT",
					"Organization slug already exists",
				);
			const now = new Date();
			const [created] = await transaction
				.insert(organization)
				.values({
					id: crypto.randomUUID(),
					name,
					slug,
					logo,
					metadata,
					status: "active",
					createdAt: now,
				})
				.returning();
			if (!created)
				throw error("CONFLICT", "Organization could not be created");
			await transaction.insert(member).values({
				id: crypto.randomUUID(),
				organizationId: created.id,
				userId: initialAdmin.id,
				role: "admin",
				createdAt: now,
			});
			await recordAdminAuditEvent(transaction, {
				eventType: "admin.organization.created",
				outcome: "success",
				reasonCode: "authorized",
				requestId: input.requestId,
				actorUserId: input.actorUserId,
				organizationId: created.id,
				targetId: created.id,
				ipAddress: input.ipAddress,
				metadata: { initial_admin_user_id: initialAdmin.id },
			});
			return { value: profile(created) };
		},
	);
	if (result.error) throw result.error;
	return result.value;
}
