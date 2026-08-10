"use server";

import {
	changePlatformRole,
	createPlatformUser,
	setPlatformUserBan,
	updatePlatformUserProfile,
} from "@krazil-idp/auth/platform-account-service";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { ActionState } from "@/lib/action-state";

import {
	actionContext,
	actionError,
	optionalValue,
	value,
} from "./action-support";
import { requirePlatformAccountOperatorAction } from "./policies";

const platformRoleSchema = z.enum(["admin", "moderator", "hr_user", "user"]);

export async function createPlatformUserAction(
	_previous: ActionState,
	formData: FormData,
): Promise<ActionState> {
	try {
		const { requestHeaders, session, requestId, ipAddress } =
			await actionContext();
		await requirePlatformAccountOperatorAction(requestHeaders);
		await createPlatformUser({
			actorUserId: session.user.id,
			name: z.string().trim().min(1).max(120).parse(value(formData, "name")),
			email: z.email().max(254).parse(value(formData, "email")),
			password: z.string().min(12).max(256).parse(value(formData, "password")),
			role: platformRoleSchema.parse(value(formData, "role") || "user"),
			requestId,
			ipAddress,
		});
		revalidatePath("/admin/platform/users");
		return { status: "success", message: "Account created" };
	} catch (error) {
		return actionError(error);
	}
}
export async function updatePlatformUserProfileAction(
	_previous: ActionState,
	formData: FormData,
): Promise<ActionState> {
	try {
		const { requestHeaders, session, requestId, ipAddress } =
			await actionContext();
		await requirePlatformAccountOperatorAction(requestHeaders);
		await updatePlatformUserProfile({
			actorUserId: session.user.id,
			targetUserId: z
				.string()
				.min(1)
				.max(128)
				.parse(value(formData, "targetUserId")),
			name: z.string().trim().min(1).max(120).parse(value(formData, "name")),
			requestId,
			ipAddress,
		});
		revalidatePath("/admin/platform/users");
		return { status: "success", message: "Account profile updated" };
	} catch (error) {
		return actionError(error);
	}
}
export async function changePlatformRoleAction(
	_previous: ActionState,
	formData: FormData,
): Promise<ActionState> {
	try {
		const { requestHeaders, session, requestId, ipAddress } =
			await actionContext();
		await requirePlatformAccountOperatorAction(requestHeaders);
		await changePlatformRole({
			actorUserId: session.user.id,
			targetUserId: z
				.string()
				.min(1)
				.max(128)
				.parse(value(formData, "targetUserId")),
			expectedCurrentRole: platformRoleSchema.parse(
				value(formData, "expectedCurrentRole"),
			),
			requestedRole: platformRoleSchema.parse(value(formData, "requestedRole")),
			requestId,
			ipAddress,
		});
		revalidatePath("/admin/platform/users");
		return { status: "success", message: "Platform role updated" };
	} catch (error) {
		return actionError(error);
	}
}
export async function setPlatformUserBanAction(
	_previous: ActionState,
	formData: FormData,
): Promise<ActionState> {
	try {
		const { requestHeaders, session, requestId, ipAddress } =
			await actionContext();
		await requirePlatformAccountOperatorAction(requestHeaders);
		await setPlatformUserBan({
			actorUserId: session.user.id,
			targetUserId: z
				.string()
				.min(1)
				.max(128)
				.parse(value(formData, "targetUserId")),
			banned: value(formData, "banned") === "true",
			banReason: optionalValue(formData, "banReason"),
			requestId,
			ipAddress,
		});
		revalidatePath("/admin/platform/users");
		return { status: "success", message: "Account access updated" };
	} catch (error) {
		return actionError(error);
	}
}
