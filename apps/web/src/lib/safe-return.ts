import type { Route } from "next";

/**
 * Fixed post-login destinations. `returnTo` handling only ever round-trips one
 * of these exact strings — arbitrary URLs, protocol-relative values, and
 * encoded externals all fail the exact-match check and fall back to the
 * default destination. Keep this module dependency-free so the allowlist is
 * unit-testable outside the server boundary.
 */
export const SAFE_RETURN_PATHS = [
	"/",
	"/dashboard",
	"/account",
	"/organizations",
	"/admin/platform",
	"/admin/platform/organizations",
	"/admin/platform/users",
	"/admin/platform/audit",
] as const;
export type SafeReturnPath = (typeof SAFE_RETURN_PATHS)[number];

export function safeReturnPath(value: unknown): SafeReturnPath | undefined {
	return typeof value === "string" &&
		SAFE_RETURN_PATHS.includes(value as SafeReturnPath)
		? (value as SafeReturnPath)
		: undefined;
}

export function signInPath(returnTo?: SafeReturnPath): Route {
	const destination = returnTo ?? "/dashboard";
	return `/sign-in?returnTo=${encodeURIComponent(destination)}` as Route;
}
