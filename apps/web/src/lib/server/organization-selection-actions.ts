"use server";

import {
	acceptOrganizationInvitation,
	rejectOrganizationInvitation,
} from "@krazil-idp/auth/organization-invitation-service";
import { setActiveOrganization } from "@krazil-idp/auth/organization-selection-service";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { ActionState } from "@/lib/action-state";

import { actionContext, actionError, value } from "./action-support";
import { AccessDeniedError, requireOrganizationAction } from "./policies";

export async function setActiveOrganizationAction(
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
		if (!access.organizationRole) {
			throw new AccessDeniedError(
				403,
				"An active organization membership is required",
			);
		}
		await setActiveOrganization({
			actorUserId: session.user.id,
			sessionId: session.session.id,
			organizationId,
			requestId,
			ipAddress,
		});
		revalidatePath("/organizations");
		revalidatePath("/dashboard");
		return { status: "success", message: "Active organization updated" };
	} catch (error) {
		return actionError(error);
	}
}
export async function resolveInvitationAction(
	_previous: ActionState,
	formData: FormData,
): Promise<ActionState> {
	try {
		const { session, requestId, ipAddress } = await actionContext();
		const invitationId = z
			.string()
			.min(1)
			.max(128)
			.parse(value(formData, "invitationId"));
		const resolution = z
			.enum(["accept", "reject"])
			.parse(value(formData, "resolution"));
		if (resolution === "accept") {
			await acceptOrganizationInvitation({
				actorUserId: session.user.id,
				invitationId,
				requestId,
				ipAddress,
			});
		} else {
			await rejectOrganizationInvitation({
				actorUserId: session.user.id,
				invitationId,
				requestId,
				ipAddress,
			});
		}
		revalidatePath("/organizations");
		return {
			status: "success",
			message:
				resolution === "accept" ? "Invitation accepted" : "Invitation declined",
		};
	} catch (error) {
		return actionError(error);
	}
}
