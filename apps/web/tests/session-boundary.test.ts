import { beforeAll, describe, expect, mock, test } from "bun:test";

import { auth } from "@krazil-idp/auth";
import { setPlatformUserBan } from "@krazil-idp/auth/platform-account-service";
import { db } from "@krazil-idp/db";
import { session, user } from "@krazil-idp/db/schema/auth";
import { eq } from "drizzle-orm";

// The page session boundary is marked server-only for bundling; stub the
// boundary markers so the fail-closed decision logic can run in-process.
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
	headers: async () => new Headers(),
}));
mock.module("next/navigation", () => ({
	redirect: (path: string) => {
		throw new Error(`NEXT_REDIRECT:${path}`);
	},
}));

const { resolveServerSession } = await import("../src/lib/server/session");

const runId = Date.now();
const password = "boundary-suite-password-1234";
const actorEmail = `boundary-actor-${runId}@example.com`;
const targetEmail = `boundary-target-${runId}@example.com`;

let actorId: string;
let targetId: string;
let targetCookies: Headers;

function cookieHeaders(headers: Headers): Headers {
	return new Headers({
		cookie: headers
			.getSetCookie()
			.map((v) => v.split(";")[0])
			.join("; "),
	});
}

async function provision(
	name: string,
	email: string,
	role: "admin" | "user",
): Promise<{ id: string; headers: Headers }> {
	await auth.api.signUpEmail({ body: { name, email, password } });
	const rows = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, email));
	const id = rows[0]?.id;
	if (!id) throw new Error(`Provisioning failed for ${email}`);
	await db
		.update(user)
		.set({ role, emailVerified: true })
		.where(eq(user.id, id));
	const signedIn = await auth.api.signInEmail({
		body: { email, password },
		returnHeaders: true,
	});
	return { id, headers: cookieHeaders(signedIn.headers) };
}

beforeAll(async () => {
	const actor = await provision("Boundary Actor", actorEmail, "admin");
	actorId = actor.id;
	const target = await provision("Boundary Target", targetEmail, "user");
	targetId = target.id;
	targetCookies = target.headers;
});

describe("page session boundary fail-closed decisions", () => {
	test("a valid session resolves to the minimal server view model", async () => {
		const resolved = await resolveServerSession(targetCookies);
		expect(resolved).not.toBeNull();
		expect(resolved?.user.id).toBe(targetId);
		expect(resolved?.user.email).toBe(targetEmail);
		expect(resolved?.user.platformRole).toBe("user");
		expect(resolved?.session.activeOrganizationId).toBeNull();
		// The boundary exposes only the minimal view model shape.
		expect(Object.keys(resolved ?? {})).toEqual(["user", "session"]);
		expect(Object.keys(resolved?.user ?? {})).toEqual([
			"id",
			"name",
			"email",
			"emailVerified",
			"platformRole",
		]);
	});

	test("active organization id passes through only as a string", async () => {
		const fixture = `org-fixture-${runId}`;
		await db
			.update(session)
			.set({ activeOrganizationId: fixture })
			.where(eq(session.userId, targetId));
		const resolved = await resolveServerSession(targetCookies);
		expect(resolved?.session.activeOrganizationId).toBe(fixture);
		await db
			.update(session)
			.set({ activeOrganizationId: null })
			.where(eq(session.userId, targetId));
		expect(
			(await resolveServerSession(targetCookies))?.session.activeOrganizationId,
		).toBeNull();
	});

	test("an expired session fails closed at the boundary", async () => {
		await db
			.update(session)
			.set({ expiresAt: new Date(Date.now() - 60_000) })
			.where(eq(session.userId, targetId));
		expect(await resolveServerSession(targetCookies)).toBeNull();
	});

	test("a banned user fails closed while their session row still exists", async () => {
		// Re-establish a live session (the expired-session read above deleted
		// the previous row), then simulate the stale window before the ban
		// sweep revokes sessions: banned flag set, session row present.
		const renewed = await auth.api.signInEmail({
			body: { email: targetEmail, password },
			returnHeaders: true,
		});
		targetCookies = cookieHeaders(renewed.headers);
		expect(await resolveServerSession(targetCookies)).not.toBeNull();
		const rows = await db
			.select({ id: session.id })
			.from(session)
			.where(eq(session.userId, targetId));
		expect(rows.length).toBeGreaterThan(0);

		await db.update(user).set({ banned: true }).where(eq(user.id, targetId));
		expect(await resolveServerSession(targetCookies)).toBeNull();
	});

	test("ban revocation deletes the session and the stale cookie fails closed", async () => {
		const unbanned = await setPlatformUserBan({
			actorUserId: actorId,
			targetUserId: targetId,
			banned: false,
			requestId: `boundary-unban-${runId}`,
		});
		expect(unbanned.banned).toBe(false);

		const reissued = await auth.api.signInEmail({
			body: { email: targetEmail, password },
			returnHeaders: true,
		});
		const liveCookies = cookieHeaders(reissued.headers);
		expect(await resolveServerSession(liveCookies)).not.toBeNull();

		const banned = await setPlatformUserBan({
			actorUserId: actorId,
			targetUserId: targetId,
			banned: true,
			banReason: "boundary suite",
			requestId: `boundary-ban-${runId}`,
		});
		expect(banned.banned).toBe(true);
		expect(await resolveServerSession(liveCookies)).toBeNull();
		const rows = await db
			.select({ id: session.id })
			.from(session)
			.where(eq(session.userId, targetId));
		expect(rows).toHaveLength(0);
	});
});
