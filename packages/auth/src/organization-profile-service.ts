import { db } from "@krazil-idp/db";
import { user } from "@krazil-idp/db/schema/auth";
import { member, organization } from "@krazil-idp/db/schema/organization";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { recordAdminAuditEvent } from "./admin-audit";
import type {
	OrganizationDisplayMetadata,
	OrganizationProfile,
	UpdateOrganizationProfileInput,
} from "./organization-lifecycle-service";
import {
	organizationMemberHasRole as hasRole,
	OrganizationPolicyError,
	type OrganizationPolicyErrorCode,
} from "./organization-policy";
import {
	isActivePolicyActor,
	type LockedUser,
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

interface ProfileUpdate {
	name?: string;
	slug?: string;
	logo?: string | null;
	metadata?: string;
}

interface ActorContext {
	actor: LockedUser;
	membership?: { id: string; role: string };
}

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
		if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || forbiddenMetadataKey.test(key))
			throw error("INVALID_INPUT", "Organization metadata key is invalid");
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

function validateUpdate(input: UpdateOrganizationProfileInput): ProfileUpdate {
	const update: ProfileUpdate = {};
	if (input.name !== undefined) update.name = nameSchema.parse(input.name);
	if (input.slug !== undefined) update.slug = slugSchema.parse(input.slug);
	if (input.logo !== undefined) update.logo = logoSchema.parse(input.logo);
	if (input.metadata !== undefined)
		update.metadata = serializeMetadata(input.metadata);
	if (Object.keys(update).length === 0)
		throw error("INVALID_INPUT", "No organization profile fields supplied");
	return update;
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

async function loadActor(
	transaction: PolicyTransaction,
	actorUserId: string,
	organizationId: string,
): Promise<ActorContext | undefined> {
	const actor = (await lockUsers(transaction, [actorUserId]))[0];
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
	return { actor, membership: memberships[0] };
}

function hasOrganizationRole(
	context: ActorContext,
	role: "admin" | "moderator",
): boolean {
	if (!context.membership) return false;
	return hasRole(
		{
			id: context.membership.id,
			userId: context.actor.id,
			organizationId: "",
			role: context.membership.role,
		},
		role,
	);
}

function mayUpdate(context: ActorContext, update: ProfileUpdate): boolean {
	if (!isActivePolicyActor(context.actor)) return false;
	if (context.actor.role === "admin" || hasOrganizationRole(context, "admin"))
		return true;
	return (
		hasOrganizationRole(context, "moderator") &&
		update.slug === undefined &&
		update.metadata === undefined
	);
}

async function denied(
	transaction: PolicyTransaction,
	input: UpdateOrganizationProfileInput,
	code: "POLICY_DENIED" | "NOT_FOUND" | "CONFLICT",
	message: string,
): Promise<OperationResult<OrganizationProfile>> {
	await recordAdminAuditEvent(transaction, {
		eventType: "admin.organization.updated",
		outcome: "denied",
		reasonCode:
			code === "POLICY_DENIED"
				? "policy_denied"
				: code === "NOT_FOUND"
					? "not_found"
					: "conflict",
		requestId: input.requestId,
		actorUserId: input.actorUserId,
		organizationId: input.organizationId,
		targetId: input.organizationId,
		ipAddress: input.ipAddress,
	});
	return { error: error(code, message) };
}

export async function updateOrganizationProfile(
	input: UpdateOrganizationProfileInput,
): Promise<OrganizationProfile> {
	if (!input.actorUserId || !input.requestId || input.requestId.length > 128)
		throw error("INVALID_INPUT", "Organization request context is invalid");
	const update = validateUpdate(input);
	const result: OperationResult<OrganizationProfile> = await db.transaction(
		async (transaction): Promise<OperationResult<OrganizationProfile>> => {
			await lockPlatformInvariant(transaction);
			const rows = await transaction
				.select()
				.from(organization)
				.where(eq(organization.id, input.organizationId))
				.for("update");
			const current = rows[0];
			if (!current)
				return denied(
					transaction,
					input,
					"NOT_FOUND",
					"Organization was not found",
				);
			const context = await loadActor(
				transaction,
				input.actorUserId,
				current.id,
			);
			if (
				!context ||
				current.status !== "active" ||
				!mayUpdate(context, update)
			)
				return denied(
					transaction,
					input,
					"POLICY_DENIED",
					"Organization profile update is not permitted",
				);
			if (update.slug && update.slug !== current.slug) {
				const conflicts = await transaction
					.select({ id: organization.id })
					.from(organization)
					.where(eq(organization.slug, update.slug));
				if (conflicts.length > 0)
					return denied(
						transaction,
						input,
						"CONFLICT",
						"Organization slug already exists",
					);
			}
			const [updated] = await transaction
				.update(organization)
				.set(update)
				.where(
					and(
						eq(organization.id, current.id),
						eq(organization.status, "active"),
					),
				)
				.returning();
			if (!updated)
				return denied(
					transaction,
					input,
					"CONFLICT",
					"Organization profile update lost its compare-and-swap",
				);
			await recordAdminAuditEvent(transaction, {
				eventType: "admin.organization.updated",
				outcome: "success",
				reasonCode: "authorized",
				requestId: input.requestId,
				actorUserId: input.actorUserId,
				organizationId: updated.id,
				targetId: updated.id,
				ipAddress: input.ipAddress,
				metadata: { fields: Object.keys(update).sort().join(",") },
			});
			return { value: profile(updated) };
		},
	);
	if (result.error) throw result.error;
	return result.value;
}

export async function readOrganizationProfile(input: {
	actorUserId: string;
	organizationId: string;
}): Promise<OrganizationProfile> {
	return db.transaction(async (transaction): Promise<OrganizationProfile> => {
		const rows = await transaction
			.select()
			.from(organization)
			.where(eq(organization.id, input.organizationId))
			.for("share");
		const current = rows[0];
		if (!current) throw error("NOT_FOUND", "Organization was not found");
		const actors = await transaction
			.select({ id: user.id, role: user.role, banned: user.banned })
			.from(user)
			.where(eq(user.id, input.actorUserId))
			.for("share");
		const actor = actors[0];
		if (!actor || actor.banned === true)
			throw error("POLICY_DENIED", "Organization access is denied");
		if (actor.role !== "admin") {
			if (current.status !== "active")
				throw error("POLICY_DENIED", "Organization access is denied");
			const memberships = await transaction
				.select({ id: member.id })
				.from(member)
				.where(
					and(
						eq(member.organizationId, current.id),
						eq(member.userId, actor.id),
					),
				)
				.for("share");
			if (memberships.length === 0)
				throw error("POLICY_DENIED", "Organization access is denied");
		}
		return profile(current);
	});
}
