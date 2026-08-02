import { db } from "@krazil-idp/db";
import { account, user } from "@krazil-idp/db/schema/auth";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { recordAdminAuditEvent } from "./admin-audit";
import type { OperatorRole } from "./permissions";
import {
	isActivePolicyActor,
	lockPlatformInvariant,
	lockUsers,
	notFoundError,
	PLATFORM_ROLE_LOOKUP,
	PlatformPolicyError,
	recordDeniedAction,
	type LockedUser,
	type PlatformPolicyContext,
	type PolicyResult,
	type PolicyTransaction,
	unwrapPolicyResult,
} from "./platform-policy";

const createUserInputSchema = z.object({
	name: z.string().trim().min(1).max(120),
	email: z.email().max(254).transform((email) => email.toLowerCase()),
	password: z.string().min(12).max(256),
	image: z.url().max(2048).nullable().optional(),
});

export interface CreatePlatformUserInput extends PlatformPolicyContext {
	name: string;
	email: string;
	password: string;
	image?: string | null;
	role?: OperatorRole;
}

interface ValidatedCreateUser {
	name: string;
	email: string;
	password: string;
	image?: string | null;
	role: OperatorRole;
}

export interface CreatedPlatformUser {
	id: string;
	name: string;
	email: string;
	role: OperatorRole;
}

function validateCreateUser(input: CreatePlatformUserInput): ValidatedCreateUser {
	const parsed = createUserInputSchema.safeParse(input);
	if (!parsed.success) {
		throw new PlatformPolicyError("INVALID_INPUT", "New user input is invalid");
	}
	const role = input.role ?? "user";
	if (PLATFORM_ROLE_LOOKUP[role] !== true) {
		throw new PlatformPolicyError("INVALID_INPUT", "Requested role is invalid");
	}
	return { ...parsed.data, role };
}

async function authorizeUserCreation(
	transaction: PolicyTransaction,
	context: PlatformPolicyContext,
	requestedRole: OperatorRole,
): Promise<PolicyResult<LockedUser>> {
	const actor = (await lockUsers(transaction, [context.actorUserId]))[0];
	if (!actor) {
		await recordDeniedAction(
			transaction,
			context,
			"admin.user.created",
			undefined,
			"not_found",
		);
		return { error: notFoundError() };
	}
	const mayAssign =
		isActivePolicyActor(actor) &&
		(actor.role === "admin" ||
			((actor.role === "moderator" || actor.role === "hr_user") &&
				requestedRole === "user"));
	if (mayAssign) return { value: actor };
	await recordDeniedAction(
		transaction,
		context,
		"admin.user.created",
		undefined,
		"policy_denied",
		{ requested_role: requestedRole },
	);
	return {
		error: new PlatformPolicyError(
			"POLICY_DENIED",
			"Actor may not create a user with the requested role",
		),
	};
}

async function insertCredentialUser(
	transaction: PolicyTransaction,
	input: ValidatedCreateUser,
	passwordHash: string,
): Promise<CreatedPlatformUser> {
	const userId = crypto.randomUUID();
	const now = new Date();
	await transaction.insert(user).values({
		id: userId,
		name: input.name,
		email: input.email,
		emailVerified: false,
		image: input.image,
		role: input.role,
		createdAt: now,
		updatedAt: now,
	});
	await transaction.insert(account).values({
		id: crypto.randomUUID(),
		accountId: userId,
		providerId: "credential",
		userId,
		password: passwordHash,
		createdAt: now,
		updatedAt: now,
	});
	return { id: userId, name: input.name, email: input.email, role: input.role };
}

async function createUserInTransaction(
	transaction: PolicyTransaction,
	context: CreatePlatformUserInput,
	input: ValidatedCreateUser,
	passwordHash: string,
): Promise<PolicyResult<CreatedPlatformUser>> {
	await lockPlatformInvariant(transaction);
	const authorization = await authorizeUserCreation(transaction, context, input.role);
	if (authorization.error) return authorization;
	const existing = await transaction
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, input.email));
	if (existing.length > 0) {
		await recordDeniedAction(
			transaction,
			context,
			"admin.user.created",
			undefined,
			"conflict",
		);
		return { error: new PlatformPolicyError("CONFLICT", "User already exists") };
	}
	const created = await insertCredentialUser(transaction, input, passwordHash);
	await recordAdminAuditEvent(transaction, {
		eventType: "admin.user.created",
		outcome: "success",
		reasonCode: "authorized",
		requestId: context.requestId,
		actorUserId: authorization.value.id,
		targetUserId: created.id,
		ipAddress: context.ipAddress,
		metadata: { assigned_role: created.role },
	});
	return { value: created };
}

export async function createPlatformUser(
	input: CreatePlatformUserInput,
): Promise<CreatedPlatformUser> {
	const validated = validateCreateUser(input);
	const passwordHash = await hashPassword(validated.password);
	const result = await db.transaction((transaction) =>
		createUserInTransaction(transaction, input, validated, passwordHash),
	);
	return unwrapPolicyResult(result);
}
