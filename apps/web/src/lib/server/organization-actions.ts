"use server";

import { createOrganization } from "@krazil-idp/auth/organization-create-service";
import {
	cancelOrganizationInvitation,
	inviteOrganizationMember,
} from "@krazil-idp/auth/organization-invitation-service";
import { changeOrganizationStatus } from "@krazil-idp/auth/organization-lifecycle-service";
import {
	changeOrganizationMemberRole,
	removeOrganizationMember,
} from "@krazil-idp/auth/organization-member-service";
import {
	readOrganizationProfile,
	updateOrganizationProfile,
} from "@krazil-idp/auth/organization-profile-service";
import { env } from "@krazil-idp/env/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { ActionState } from "@/lib/action-state";

import {
	actionContext,
	actionError,
	optionalValue,
	value,
} from "./action-support";
import {
	AccessDeniedError,
	requireOrganizationAction,
	requirePlatformAdminAction,
} from "./policies";

const organizationStatusSchema = z.enum(["active", "suspended", "archived"]);
const organizationRoleSchema = z.enum(["admin", "moderator", "user"]);

export async function createOrganizationAction(
	_previous: ActionState,
	formData: FormData,
): Promise<ActionState> {
	try {
		const { requestHeaders, session, requestId, ipAddress } =
			await actionContext();
		await requirePlatformAdminAction(requestHeaders);
		const input = z
			.object({
				name: z.string().trim().min(1).max(120),
				slug: z
					.string()
					.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
					.max(63),
				initialAdminUserId: z.string().min(1).max(128),
				logo: z.string().url().max(2048).optional(),
			})
			.parse({
				name: value(formData, "name"),
				slug: value(formData, "slug"),
				initialAdminUserId: value(formData, "initialAdminUserId"),
				logo: optionalValue(formData, "logo"),
			});
		await createOrganization({
			...input,
			actorUserId: session.user.id,
			requestId,
			ipAddress,
		});
		revalidatePath("/admin/platform/organizations");
		return { status: "success", message: "Organization created" };
	} catch (error) {
		return actionError(error);
	}
}
export async function changeOrganizationStatusAction(
	_previous: ActionState,
	formData: FormData,
): Promise<ActionState> {
	try {
		const { requestHeaders, session, requestId, ipAddress } =
			await actionContext();
		await requirePlatformAdminAction(requestHeaders);
		const organizationId = z
			.string()
			.min(1)
			.max(128)
			.parse(value(formData, "organizationId"));
		const expectedStatus = organizationStatusSchema.parse(
			value(formData, "expectedStatus"),
		);
		const requestedStatus = organizationStatusSchema.parse(
			value(formData, "requestedStatus"),
		);
		if (requestedStatus === "archived") {
			const profile = await readOrganizationProfile({
				actorUserId: session.user.id,
				organizationId,
			});
			if (value(formData, "confirmation") !== profile.name) {
				return {
					status: "error",
					message: "Type the organization name to archive it",
				};
			}
		}
		await changeOrganizationStatus({
			actorUserId: session.user.id,
			organizationId,
			expectedStatus,
			requestedStatus,
			requestId,
			ipAddress,
		});
		revalidatePath("/admin/platform/organizations");
		revalidatePath(`/admin/organizations/${organizationId}`);
		return { status: "success", message: "Organization status updated" };
	} catch (error) {
		return actionError(error);
	}
}
export async function updateOrganizationProfileAction(
	_previous: ActionState,
	formData: FormData,
): Promise<ActionState> {
	try {
		const { requestHeaders, session, requestId, ipAddress } =
			await actionContext();
		const organizationId = z
			.string()
			.min(1)
			.max(128)
			.parse(value(formData, "organizationId"));
		const { access } = await requireOrganizationAction(
			requestHeaders,
			organizationId,
		);
		if (!access.canManageProfile) {
			throw new AccessDeniedError(403, "Organization profile access is denied");
		}
		await updateOrganizationProfile({
			actorUserId: session.user.id,
			organizationId,
			name: optionalValue(formData, "name"),
			slug:
				access.isPlatformAdmin || access.organizationRole === "admin"
					? optionalValue(formData, "slug")
					: undefined,
			logo: optionalValue(formData, "logo") ?? null,
			requestId,
			ipAddress,
		});
		revalidatePath(`/admin/organizations/${organizationId}`);
		return { status: "success", message: "Organization profile updated" };
	} catch (error) {
		return actionError(error);
	}
}
export async function inviteOrganizationMemberAction(
	_previous: ActionState,
	formData: FormData,
): Promise<ActionState> {
	try {
		const { requestHeaders, session, requestId, ipAddress } =
			await actionContext();
		const organizationId = z
			.string()
			.min(1)
			.max(128)
			.parse(value(formData, "organizationId"));
		const { access } = await requireOrganizationAction(
			requestHeaders,
			organizationId,
		);
		if (!access.canInviteMembers)
			throw new AccessDeniedError(403, "Invitation access is denied");
		const invitation = await inviteOrganizationMember({
			actorUserId: session.user.id,
			organizationId,
			email: z.email().max(254).parse(value(formData, "email")),
			role: organizationRoleSchema.parse(value(formData, "role")),
			requestId,
			ipAddress,
		});
		const shareLink = new URL(
			`/organizations/invitations/${invitation.id}`,
			env.BETTER_AUTH_URL,
		).toString();
		revalidatePath(`/admin/organizations/${organizationId}`);
		return { status: "success", message: "Invitation created", shareLink };
	} catch (error) {
		return actionError(error);
	}
}
export async function cancelOrganizationInvitationAction(
	_previous: ActionState,
	formData: FormData,
): Promise<ActionState> {
	try {
		const { requestHeaders, session, requestId, ipAddress } =
			await actionContext();
		const organizationId = z
			.string()
			.min(1)
			.max(128)
			.parse(value(formData, "organizationId"));
		const invitationId = z
			.string()
			.min(1)
			.max(128)
			.parse(value(formData, "invitationId"));
		const { access } = await requireOrganizationAction(
			requestHeaders,
			organizationId,
		);
		if (!access.canInviteMembers)
			throw new AccessDeniedError(403, "Invitation access is denied");
		await cancelOrganizationInvitation({
			actorUserId: session.user.id,
			organizationId,
			invitationId,
			requestId,
			ipAddress,
		});
		revalidatePath(`/admin/organizations/${organizationId}`);
		return { status: "success", message: "Invitation cancelled" };
	} catch (error) {
		return actionError(error);
	}
}
export async function changeOrganizationMemberRoleAction(
	_previous: ActionState,
	formData: FormData,
): Promise<ActionState> {
	try {
		const { requestHeaders, session, requestId, ipAddress } =
			await actionContext();
		const organizationId = z
			.string()
			.min(1)
			.max(128)
			.parse(value(formData, "organizationId"));
		const { access } = await requireOrganizationAction(
			requestHeaders,
			organizationId,
		);
		if (!access.canChangeMemberRoles)
			throw new AccessDeniedError(403, "Member role access is denied");
		await changeOrganizationMemberRole({
			actorUserId: session.user.id,
			organizationId,
			targetUserId: z
				.string()
				.min(1)
				.max(128)
				.parse(value(formData, "targetUserId")),
			expectedCurrentRole: organizationRoleSchema.parse(
				value(formData, "expectedCurrentRole"),
			),
			requestedRole: organizationRoleSchema.parse(
				value(formData, "requestedRole"),
			),
			requestId,
			ipAddress,
		});
		revalidatePath(`/admin/organizations/${organizationId}`);
		return { status: "success", message: "Member role updated" };
	} catch (error) {
		return actionError(error);
	}
}
export async function removeOrganizationMemberAction(
	_previous: ActionState,
	formData: FormData,
): Promise<ActionState> {
	try {
		const { requestHeaders, session, requestId, ipAddress } =
			await actionContext();
		const organizationId = z
			.string()
			.min(1)
			.max(128)
			.parse(value(formData, "organizationId"));
		const { access } = await requireOrganizationAction(
			requestHeaders,
			organizationId,
		);
		if (!access.canManageMembers)
			throw new AccessDeniedError(403, "Member removal access is denied");
		await removeOrganizationMember({
			actorUserId: session.user.id,
			organizationId,
			targetUserId: z
				.string()
				.min(1)
				.max(128)
				.parse(value(formData, "targetUserId")),
			expectedCurrentRole: organizationRoleSchema.parse(
				value(formData, "expectedCurrentRole"),
			),
			requestId,
			ipAddress,
		});
		revalidatePath(`/admin/organizations/${organizationId}`);
		return { status: "success", message: "Member removed" };
	} catch (error) {
		return actionError(error);
	}
}
