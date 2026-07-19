import { beforeAll, describe, expect, test } from "bun:test";
import { auth } from "@krazil-idp/auth";
import { db } from "@krazil-idp/db";
import { user } from "@krazil-idp/db/schema/auth";
import { eq } from "drizzle-orm";

const issuer = "http://localhost:3000/api/auth";
const runId = Date.now();
const password = "operator-suite-password-1234";

let adminHeaders: Headers;
let moderatorHeaders: Headers;
let plainHeaders: Headers;
let adminId: string;
let employeeId: string;
const employeeEmail = `employee-${runId}@example.com`;

async function provision(
	name: string,
	email: string,
	role: "admin" | "moderator" | "user",
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
	return {
		id,
		headers: new Headers({
			cookie: signedIn.headers
				.getSetCookie()
				.map((v) => v.split(";")[0])
				.join("; "),
		}),
	};
}

function adminRequest(
	path: string,
	headers: Headers,
	body?: Record<string, unknown>,
): Promise<Response> {
	return auth.handler(
		new Request(`${issuer}${path}`, {
			method: body ? "POST" : "GET",
			headers: new Headers({
				cookie: headers.get("cookie") ?? "",
				...(body ? { "content-type": "application/json" } : {}),
			}),
			...(body ? { body: JSON.stringify(body) } : {}),
		}),
	);
}

async function signInStatus(email: string): Promise<number> {
	const response = await auth.handler(
		new Request(`${issuer}/sign-in/email`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email, password }),
		}),
	);
	return response.status;
}

beforeAll(async () => {
	const admin = await provision(
		"Role Suite Admin",
		`role-admin-${runId}@example.com`,
		"admin",
	);
	adminHeaders = admin.headers;
	adminId = admin.id;
	const moderator = await provision(
		"Role Suite Moderator",
		`role-moderator-${runId}@example.com`,
		"moderator",
	);
	moderatorHeaders = moderator.headers;
	const plain = await provision(
		"Role Suite User",
		`role-user-${runId}@example.com`,
		"user",
	);
	plainHeaders = plain.headers;
	const employee = await provision("Employee", employeeEmail, "user");
	employeeId = employee.id;
});

describe("moderator role (CRU, no delete)", () => {
	test("creates accounts but cannot grant roles at creation", async () => {
		const created = await adminRequest("/admin/create-user", moderatorHeaders, {
			name: "Hired Employee",
			email: `hired-${runId}@example.com`,
			password,
		});
		expect(created.status).toBe(200);
		const escalation = await adminRequest(
			"/admin/create-user",
			moderatorHeaders,
			{
				name: "Sneaky Admin",
				email: `sneaky-${runId}@example.com`,
				password,
				role: "admin",
			},
		);
		expect(escalation.status).toBe(403);
	});

	test("lists users", async () => {
		const response = await adminRequest(
			"/admin/list-users?limit=5",
			moderatorHeaders,
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { users: unknown[]; total: number };
		expect(body.total).toBeGreaterThanOrEqual(4);
	});

	test("updates profile fields but not role, email, or password", async () => {
		const rename = await adminRequest("/admin/update-user", moderatorHeaders, {
			userId: employeeId,
			data: { name: "Employee Renamed" },
		});
		expect(rename.status).toBe(200);

		const roleChange = await adminRequest(
			"/admin/update-user",
			moderatorHeaders,
			{ userId: employeeId, data: { role: "moderator" } },
		);
		expect(roleChange.status).toBe(403);

		const setRole = await adminRequest("/admin/set-role", moderatorHeaders, {
			userId: employeeId,
			role: "moderator",
		});
		expect(setRole.status).toBe(403);

		const emailChange = await adminRequest(
			"/admin/update-user",
			moderatorHeaders,
			{ userId: employeeId, data: { email: `stolen-${runId}@example.com` } },
		);
		expect(emailChange.status).toBe(403);

		const passwordChange = await adminRequest(
			"/admin/set-user-password",
			moderatorHeaders,
			{ userId: employeeId, newPassword: "hijacked-password-1234" },
		);
		expect(passwordChange.status).toBe(403);
	});

	test("ban disables sign-in and revokes sessions; unban restores access", async () => {
		const banned = await adminRequest("/admin/ban-user", moderatorHeaders, {
			userId: employeeId,
			banReason: "Offboarding hold",
		});
		expect(banned.status).toBe(200);
		expect(await signInStatus(employeeEmail)).toBe(403);

		const unbanned = await adminRequest("/admin/unban-user", moderatorHeaders, {
			userId: employeeId,
		});
		expect(unbanned.status).toBe(200);
		expect(await signInStatus(employeeEmail)).toBe(200);
	});

	test("cannot delete accounts", async () => {
		const removed = await adminRequest("/admin/remove-user", moderatorHeaders, {
			userId: employeeId,
		});
		expect(removed.status).toBe(403);
		const stillThere = await db
			.select({ id: user.id })
			.from(user)
			.where(eq(user.id, employeeId));
		expect(stillThere).toHaveLength(1);
	});

	test("cannot ban or ban-edit an admin account", async () => {
		const direct = await adminRequest("/admin/ban-user", moderatorHeaders, {
			userId: adminId,
			banReason: "hostile takeover",
		});
		expect(direct.status).toBe(403);

		const viaUpdate = await adminRequest(
			"/admin/update-user",
			moderatorHeaders,
			{ userId: adminId, data: { banned: true } },
		);
		expect(viaUpdate.status).toBe(403);

		const rows = await db
			.select({ banned: user.banned })
			.from(user)
			.where(eq(user.id, adminId));
		expect(rows[0]?.banned).not.toBe(true);
	});

	test("cannot impersonate", async () => {
		const response = await adminRequest(
			"/admin/impersonate-user",
			moderatorHeaders,
			{ userId: employeeId },
		);
		expect(response.status).toBe(403);
	});
});

describe("role boundaries", () => {
	test("regular users get no operator access", async () => {
		const list = await adminRequest("/admin/list-users?limit=1", plainHeaders);
		expect(list.status).toBe(403);
		const ban = await adminRequest("/admin/ban-user", plainHeaders, {
			userId: employeeId,
		});
		expect(ban.status).toBe(403);
	});

	test("admins retain delete", async () => {
		const disposable = await provision(
			"Disposable",
			`disposable-${runId}@example.com`,
			"user",
		);
		const removed = await adminRequest("/admin/remove-user", adminHeaders, {
			userId: disposable.id,
		});
		expect(removed.status).toBe(200);
		const gone = await db
			.select({ id: user.id })
			.from(user)
			.where(eq(user.id, disposable.id));
		expect(gone).toHaveLength(0);
	});
});
