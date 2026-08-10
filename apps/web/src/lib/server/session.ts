import "server-only";

import { auth } from "@krazil-idp/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
	SAFE_RETURN_PATHS,
	type SafeReturnPath,
	safeReturnPath,
	signInPath,
} from "../safe-return";

export const PLATFORM_ROLES = [
	"admin",
	"moderator",
	"hr_user",
	"user",
] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export type { SafeReturnPath };
export { SAFE_RETURN_PATHS, safeReturnPath, signInPath };

export interface ServerSession {
	user: {
		id: string;
		name: string;
		email: string;
		emailVerified: boolean;
		platformRole: PlatformRole;
	};
	session: {
		id: string;
		expiresAt: Date;
		activeOrganizationId: string | null;
	};
}

function isPlatformRole(value: unknown): value is PlatformRole {
	return (
		typeof value === "string" && PLATFORM_ROLES.includes(value as PlatformRole)
	);
}

function isExpired(value: unknown): boolean {
	const expiresAt = new Date(value as string | number | Date);
	return Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date();
}

export async function resolveServerSession(
	requestHeaders?: Headers,
): Promise<ServerSession | null> {
	const currentHeaders = requestHeaders ?? (await headers());
	const session = await auth.api.getSession({ headers: currentHeaders });
	if (
		!session?.user ||
		!session.session ||
		isExpired(session.session.expiresAt)
	) {
		return null;
	}

	const sessionUser = session.user as typeof session.user & {
		banned?: unknown;
		role?: unknown;
	};
	if (sessionUser.banned === true) return null;

	const sessionRecord = session.session as typeof session.session & {
		activeOrganizationId?: unknown;
	};
	const activeOrganizationId =
		typeof sessionRecord.activeOrganizationId === "string"
			? sessionRecord.activeOrganizationId
			: null;

	return {
		user: {
			id: session.user.id,
			name: session.user.name,
			email: session.user.email,
			emailVerified: session.user.emailVerified,
			platformRole: isPlatformRole(sessionUser.role)
				? sessionUser.role
				: "user",
		},
		session: {
			id: session.session.id,
			expiresAt: new Date(session.session.expiresAt),
			activeOrganizationId,
		},
	};
}

export async function requirePageSession(
	returnTo?: SafeReturnPath,
): Promise<ServerSession> {
	const session = await resolveServerSession();
	if (!session) redirect(signInPath(returnTo));
	return session;
}

export function requestIp(requestHeaders: Headers): string | undefined {
	const forwarded = requestHeaders.get("x-forwarded-for");
	if (!forwarded) return undefined;
	const ipAddress = forwarded.split(",", 1)[0]?.trim();
	return ipAddress && ipAddress.length <= 128 ? ipAddress : undefined;
}
