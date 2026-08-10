import "server-only";

import { OrganizationPolicyError } from "@krazil-idp/auth/organization-policy";
import { PlatformPolicyError } from "@krazil-idp/auth/platform-account-service";
import { headers } from "next/headers";
import { z } from "zod";

import type { ActionState } from "@/lib/action-state";

import { AccessDeniedError, requireAuthenticatedAction } from "./policies";
import { requestIp } from "./session";

export function value(formData: FormData, key: string): string {
	const candidate = formData.get(key);
	return typeof candidate === "string" ? candidate.trim() : "";
}

export function optionalValue(
	formData: FormData,
	key: string,
): string | undefined {
	const candidate = value(formData, key);
	return candidate || undefined;
}

export function actionError(error: unknown): ActionState {
	if (error instanceof AccessDeniedError) {
		return { status: "error", message: error.message };
	}
	if (
		error instanceof PlatformPolicyError ||
		error instanceof OrganizationPolicyError
	) {
		return { status: "error", message: error.message };
	}
	if (error instanceof z.ZodError) {
		return {
			status: "error",
			message: "Review the highlighted fields and try again",
		};
	}
	return { status: "error", message: "The request could not be completed" };
}

export async function actionContext() {
	const requestHeaders = await headers();
	const session = await requireAuthenticatedAction(requestHeaders);
	return {
		requestHeaders,
		session,
		requestId: crypto.randomUUID(),
		ipAddress: requestIp(requestHeaders),
	};
}
