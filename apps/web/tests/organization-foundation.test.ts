import { beforeAll, describe, expect, test } from "bun:test";
import { auth } from "@krazil-idp/auth";
import {
	deliverAdminAuditOutbox,
	recordAdminAuditEvent,
	recordAdminAuditEventInTransaction,
} from "@krazil-idp/auth/admin-audit";
import { createOrganization } from "@krazil-idp/auth/organization-create-service";
import {
	changeOrganizationMemberRole,
	OrganizationPolicyError,
	removeOrganizationMember,
} from "@krazil-idp/auth/organization-member-service";
import { addOrganizationMember } from "@krazil-idp/auth/organization-membership-service";
import { setActiveOrganization } from "@krazil-idp/auth/organization-selection-service";
import { organizationRoles } from "@krazil-idp/auth/permissions";
import {
	changePlatformRole,
	createPlatformUser,
	PlatformPolicyError,
	setPlatformUserBan,
} from "@krazil-idp/auth/platform-account-service";
import { db } from "@krazil-idp/db";
import {
	adminAuditEvent,
	adminAuditOutbox,
} from "@krazil-idp/db/schema/admin-audit";
import { session as authSession, user } from "@krazil-idp/db/schema/auth";
import {
	invitation,
	member,
	organization,
} from "@krazil-idp/db/schema/organization";
import { tenantDatabaseBinding } from "@krazil-idp/db/schema/tenant-database-binding";
import { and, eq, inArray } from "drizzle-orm";

const issuer = "http://localhost:3000/api/auth";
const runId = Date.now();
const password = "organization-foundation-password-1234";

let adminId: string;
let moderatorId: string;
let hrUserId: string;
let plainUserId: string;
let adminHeaders: Headers;
let organizationId: string;

function cookieHeaders(headers: Headers): Headers {
	return new Headers({
		cookie: headers
			.getSetCookie()
			.map((value) => value.split(";")[0])
			.join("; "),
	});
}

async function provision(
	name: string,
	email: string,
	role: "admin" | "moderator" | "hr_user" | "user",
): Promise<{ id: string; headers: Headers }> {
	await auth.api.signUpEmail({ body: { name, email, password } });
	const rows = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, email));
	const id = rows[0]?.id;
	if (!id) throw new Error("Phase 1 test user provisioning failed");
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

async function expectPolicyCode(
	operation: Promise<unknown>,
	code: PlatformPolicyError["code"],
): Promise<void> {
	try {
		await operation;
		throw new Error("Expected platform policy rejection");
	} catch (error) {
		expect(error).toBeInstanceOf(PlatformPolicyError);
		expect((error as PlatformPolicyError).code).toBe(code);
	}
}

async function expectDatabaseRejection(
	operation: Promise<unknown>,
): Promise<void> {
	let rejection: unknown;
	try {
		await operation;
	} catch (error) {
		rejection = error;
	}
	expect(rejection).toBeInstanceOf(Error);
}

async function expectOrganizationPolicyCode(
	operation: Promise<unknown>,
	code: OrganizationPolicyError["code"],
): Promise<void> {
	let rejection: unknown;
	try {
		await operation;
	} catch (error) {
		rejection = error;
	}
	expect(rejection).toBeInstanceOf(OrganizationPolicyError);
	expect((rejection as OrganizationPolicyError).code).toBe(code);
}

beforeAll(async () => {
	const admin = await provision(
		"Phase 1 Admin",
		`phase1-admin-${runId}@example.com`,
		"admin",
	);
	adminId = admin.id;
	adminHeaders = admin.headers;
	moderatorId = (
		await provision(
			"Phase 1 Moderator",
			`phase1-moderator-${runId}@example.com`,
			"moderator",
		)
	).id;
	hrUserId = (
		await provision("Phase 1 HR", `phase1-hr-${runId}@example.com`, "hr_user")
	).id;
	plainUserId = (
		await provision("Phase 1 User", `phase1-user-${runId}@example.com`, "user")
	).id;
});

describe("organization plugin foundation", () => {
	test("uses the approved custom role permissions without an owner role", () => {
		expect(
			organizationRoles.admin.authorize({ organization: ["update"] }).success,
		).toBe(true);
		expect(
			organizationRoles.admin.authorize({ organization: ["delete"] }).success,
		).toBe(false);
		expect(
			organizationRoles.moderator.authorize({ member: ["delete"] }).success,
		).toBe(true);
		expect(
			organizationRoles.moderator.authorize({ member: ["create"] }).success,
		).toBe(false);
		expect(
			organizationRoles.moderator.authorize({ member: ["update"] }).success,
		).toBe(false);
		expect(
			organizationRoles.moderator.authorize({ invitation: ["create"] }).success,
		).toBe(false);
		expect(
			organizationRoles.moderator.authorize({ invitation: ["cancel"] }).success,
		).toBe(false);
		expect(
			organizationRoles.user.authorize({ member: ["delete"] }).success,
		).toBe(false);
		expect(Object.keys(organizationRoles).sort()).toEqual([
			"admin",
			"moderator",
			"user",
		]);
	});

	test("creates an internal organization with admin creator role", async () => {
		const created = await createOrganization({
			actorUserId: adminId,
			initialAdminUserId: adminId,
			name: "Phase 1 Organization",
			slug: `phase-1-${runId}`,
			requestId: `phase1-create-${runId}`,
		});
		organizationId = created.id;
		const memberships = await db
			.select({ role: member.role })
			.from(member)
			.where(
				and(eq(member.organizationId, created.id), eq(member.userId, adminId)),
			);
		expect(memberships).toEqual([{ role: "admin" }]);
	});

	test("activates an authorized organization on the exact session", async () => {
		const sessions = await db
			.select({ id: authSession.id })
			.from(authSession)
			.where(eq(authSession.userId, adminId));
		const currentSession = sessions[0];
		if (!currentSession)
			throw new Error("Activation session fixture was not found");

		await setActiveOrganization({
			actorUserId: adminId,
			sessionId: currentSession.id,
			organizationId,
			requestId: `phase1-activate-${runId}`,
		});
		const updated = await db
			.select({ activeOrganizationId: authSession.activeOrganizationId })
			.from(authSession)
			.where(eq(authSession.id, currentSession.id));
		expect(updated).toEqual([{ activeOrganizationId: organizationId }]);
	});

	test("blocks raw HTTP organization and platform mutations", async () => {
		const headers = new Headers({
			cookie: adminHeaders.get("cookie") ?? "",
			"content-type": "application/json",
		});
		const createOrganization = await auth.handler(
			new Request(`${issuer}/organization/create`, {
				method: "POST",
				headers,
				body: JSON.stringify({ name: "Blocked", slug: `blocked-${runId}` }),
			}),
		);
		const banUser = await auth.handler(
			new Request(`${issuer}/admin/ban-user`, {
				method: "POST",
				headers,
				body: JSON.stringify({ userId: plainUserId }),
			}),
		);
		for (const path of [
			"/organization/set-active",
			"/organization/remove-member",
			"/organization/update-member-role",
			"/organization/invite-member",
			"/organization/cancel-invitation",
		]) {
			const response = await auth.handler(
				new Request(`${issuer}${path}`, {
					method: "POST",
					headers,
					body: "{}",
				}),
			);
			expect(response.status).toBe(403);
		}
		const serverOnlyAddMember = await auth.handler(
			new Request(`${issuer}/organization/add-member`, {
				method: "POST",
				headers,
				body: "{}",
			}),
		);
		expect(serverOnlyAddMember.status).toBe(404);
		expect(createOrganization.status).toBe(403);
		expect(banUser.status).toBe(403);
	});
});

describe("organization member policy", () => {
	test("enforces role hierarchy and serializes the last-admin invariant", async () => {
		await addOrganizationMember({
			actorUserId: adminId,
			organizationId,
			targetUserId: moderatorId,
			requestedRole: "admin",
			requestId: `phase1-add-moderator-${runId}`,
		});
		await addOrganizationMember({
			actorUserId: adminId,
			organizationId,
			targetUserId: plainUserId,
			requestedRole: "admin",
			requestId: `phase1-add-user-${runId}`,
		});
		await addOrganizationMember({
			actorUserId: adminId,
			organizationId,
			targetUserId: hrUserId,
			requestedRole: "moderator",
			requestId: `phase1-add-hr-${runId}`,
		});
		await db.update(user).set({ banned: true }).where(eq(user.id, plainUserId));
		await expectOrganizationPolicyCode(
			changeOrganizationMemberRole({
				organizationId,
				actorUserId: plainUserId,
				targetUserId: plainUserId,
				expectedCurrentRole: "admin",
				requestedRole: "moderator",
				requestId: `organization-inactive-actor-${runId}`,
			}),
			"POLICY_DENIED",
		);
		await db
			.update(user)
			.set({ banned: false })
			.where(eq(user.id, plainUserId));

		await expectOrganizationPolicyCode(
			changeOrganizationMemberRole({
				organizationId,
				actorUserId: hrUserId,
				targetUserId: adminId,
				expectedCurrentRole: "admin",
				requestedRole: "user",
				requestId: `organization-role-denied-${runId}`,
			}),
			"POLICY_DENIED",
		);
		await expectOrganizationPolicyCode(
			removeOrganizationMember({
				organizationId,
				actorUserId: hrUserId,
				targetUserId: adminId,
				expectedCurrentRole: "admin",
				requestId: `organization-remove-denied-${runId}`,
			}),
			"POLICY_DENIED",
		);

		const outcomes = await Promise.allSettled([
			changeOrganizationMemberRole({
				organizationId,
				actorUserId: adminId,
				targetUserId: adminId,
				expectedCurrentRole: "admin",
				requestedRole: "moderator",
				requestId: `organization-concurrent-admin-${runId}`,
			}),
			changeOrganizationMemberRole({
				organizationId,
				actorUserId: moderatorId,
				targetUserId: moderatorId,
				expectedCurrentRole: "admin",
				requestedRole: "moderator",
				requestId: `organization-concurrent-moderator-${runId}`,
			}),
			changeOrganizationMemberRole({
				organizationId,
				actorUserId: plainUserId,
				targetUserId: plainUserId,
				expectedCurrentRole: "admin",
				requestedRole: "moderator",
				requestId: `organization-concurrent-user-${runId}`,
			}),
		]);
		const successes = outcomes.filter(
			(result) => result.status === "fulfilled",
		);
		const failures = outcomes.filter(
			(result): result is PromiseRejectedResult => result.status === "rejected",
		);
		expect(successes).toHaveLength(2);
		expect(failures).toHaveLength(1);
		const firstFailure = failures[0];
		if (!firstFailure)
			throw new Error("concurrent policy failure was not recorded");
		expect((firstFailure.reason as OrganizationPolicyError).code).toBe(
			"LAST_ADMIN_PROTECTED",
		);

		const activeAdmins = await db
			.select({ userId: member.userId })
			.from(member)
			.where(
				and(
					eq(member.organizationId, organizationId),
					eq(member.role, "admin"),
				),
			);
		expect(activeAdmins).toHaveLength(1);
		const lastAdmin = activeAdmins[0];
		if (!lastAdmin) throw new Error("last admin fixture was not found");
		await expectOrganizationPolicyCode(
			changeOrganizationMemberRole({
				organizationId,
				actorUserId: lastAdmin.userId,
				targetUserId: lastAdmin.userId,
				expectedCurrentRole: "admin",
				requestedRole: "moderator",
				requestId: `organization-last-admin-demote-${runId}`,
			}),
			"LAST_ADMIN_PROTECTED",
		);
		await expectOrganizationPolicyCode(
			removeOrganizationMember({
				organizationId,
				actorUserId: lastAdmin.userId,
				targetUserId: lastAdmin.userId,
				expectedCurrentRole: "admin",
				requestId: `organization-last-admin-remove-${runId}`,
			}),
			"LAST_ADMIN_PROTECTED",
		);

		const lastAdminAudit = await db
			.select({
				outcome: adminAuditEvent.outcome,
				reasonCode: adminAuditEvent.reasonCode,
			})
			.from(adminAuditEvent)
			.where(
				eq(
					adminAuditEvent.requestId,
					`organization-last-admin-remove-${runId}`,
				),
			);
		expect(lastAdminAudit).toEqual([
			{ outcome: "denied", reasonCode: "last_admin_protected" },
		]);
		const concurrentAudit = await db
			.select({ outcome: adminAuditEvent.outcome })
			.from(adminAuditEvent)
			.where(
				inArray(adminAuditEvent.requestId, [
					`organization-concurrent-admin-${runId}`,
					`organization-concurrent-moderator-${runId}`,
					`organization-concurrent-user-${runId}`,
				]),
			);
		expect(concurrentAudit).toHaveLength(3);
		expect(
			concurrentAudit.filter((event) => event.outcome === "success"),
		).toHaveLength(2);
		expect(
			concurrentAudit.filter((event) => event.outcome === "denied"),
		).toHaveLength(1);
	});
});

describe("platform account policy", () => {
	test("enforces creation and role-assignment ceilings", async () => {
		const created = await createPlatformUser({
			actorUserId: moderatorId,
			requestId: `create-user-${runId}`,
			name: "Created by Moderator",
			email: `created-by-moderator-${runId}@example.com`,
			password,
		});
		expect(created.role).toBe("user");
		await expectPolicyCode(
			createPlatformUser({
				actorUserId: hrUserId,
				requestId: `create-admin-denied-${runId}`,
				name: "Denied Admin",
				email: `denied-admin-${runId}@example.com`,
				password,
				role: "admin",
			}),
			"POLICY_DENIED",
		);
	});

	test("allows non-last admin bans and serializes the last-admin invariant", async () => {
		const secondAdmin = await createPlatformUser({
			actorUserId: adminId,
			requestId: `ban-second-admin-create-${runId}`,
			name: "Second Platform Admin",
			email: `second-platform-admin-${runId}@example.com`,
			password,
			role: "admin",
		});
		const thirdAdmin = await createPlatformUser({
			actorUserId: adminId,
			requestId: `ban-third-admin-create-${runId}`,
			name: "Third Platform Admin",
			email: `third-platform-admin-${runId}@example.com`,
			password,
			role: "admin",
		});
		const nonLast = await setPlatformUserBan({
			actorUserId: adminId,
			targetUserId: secondAdmin.id,
			banned: true,
			requestId: `ban-second-admin-${runId}`,
		});
		expect(nonLast.banned).toBe(true);
		await setPlatformUserBan({
			actorUserId: adminId,
			targetUserId: secondAdmin.id,
			banned: false,
			requestId: `unban-second-admin-${runId}`,
		});

		const outcomes = await Promise.allSettled([
			setPlatformUserBan({
				actorUserId: adminId,
				targetUserId: secondAdmin.id,
				banned: true,
				requestId: `ban-concurrent-second-${runId}`,
			}),
			setPlatformUserBan({
				actorUserId: secondAdmin.id,
				targetUserId: thirdAdmin.id,
				banned: true,
				requestId: `ban-concurrent-third-${runId}`,
			}),
			setPlatformUserBan({
				actorUserId: thirdAdmin.id,
				targetUserId: adminId,
				banned: true,
				requestId: `ban-concurrent-first-${runId}`,
			}),
		]);
		const successes = outcomes.filter(
			(result) => result.status === "fulfilled",
		);
		const failures = outcomes.filter(
			(result): result is PromiseRejectedResult => result.status === "rejected",
		);
		expect(successes).toHaveLength(2);
		expect(failures).toHaveLength(1);
		const firstFailure = failures[0];
		if (!firstFailure)
			throw new Error("concurrent ban failure was not recorded");
		expect((firstFailure.reason as PlatformPolicyError).code).toBe(
			"POLICY_DENIED",
		);
		const fixtureAdminIds = [adminId, secondAdmin.id, thirdAdmin.id];
		const fixtureActiveAdmins = await db
			.select({ id: user.id })
			.from(user)
			.where(and(inArray(user.id, fixtureAdminIds), eq(user.banned, false)));
		expect(fixtureActiveAdmins).toHaveLength(1);
		const fixtureActiveAdmin = fixtureActiveAdmins[0];
		if (!fixtureActiveAdmin) {
			throw new Error("active platform admin fixture was not found");
		}
		for (const targetUserId of fixtureAdminIds.filter(
			(id) => id !== fixtureActiveAdmin.id,
		)) {
			await setPlatformUserBan({
				actorUserId: fixtureActiveAdmin.id,
				targetUserId,
				banned: false,
				requestId: `restore-fixture-admin-${targetUserId}-${runId}`,
			});
		}

		const activeAdminSnapshot = await db
			.select({ id: user.id })
			.from(user)
			.where(and(eq(user.role, "admin"), eq(user.banned, false)));
		for (const target of activeAdminSnapshot.filter(
			(admin) => admin.id !== adminId,
		)) {
			await setPlatformUserBan({
				actorUserId: adminId,
				targetUserId: target.id,
				banned: true,
				requestId: `reduce-active-admin-${target.id}-${runId}`,
			});
		}
		const lastActiveAdmins = await db
			.select({ id: user.id })
			.from(user)
			.where(and(eq(user.role, "admin"), eq(user.banned, false)));
		expect(lastActiveAdmins).toEqual([{ id: adminId }]);
		const inactiveActorId = activeAdminSnapshot.find(
			(admin) => admin.id !== adminId,
		)?.id;
		if (!inactiveActorId) {
			throw new Error("inactive platform admin fixture was not found");
		}
		await expectPolicyCode(
			setPlatformUserBan({
				actorUserId: inactiveActorId,
				targetUserId: adminId,
				banned: true,
				requestId: `ban-inactive-actor-${runId}`,
			}),
			"POLICY_DENIED",
		);
		await expectPolicyCode(
			setPlatformUserBan({
				actorUserId: adminId,
				targetUserId: adminId,
				banned: true,
				requestId: `ban-last-admin-${runId}`,
			}),
			"LAST_ADMIN_PROTECTED",
		);
		for (const target of activeAdminSnapshot.filter(
			(admin) => admin.id !== adminId,
		)) {
			await setPlatformUserBan({
				actorUserId: adminId,
				targetUserId: target.id,
				banned: false,
				requestId: `restore-active-admin-${target.id}-${runId}`,
			});
		}
	});

	test("enforces target, destination, self-change, and stale-role policy", async () => {
		const target = await createPlatformUser({
			actorUserId: adminId,
			requestId: `role-target-${runId}`,
			name: "Role Target",
			email: `role-target-${runId}@example.com`,
			password,
		});
		const changed = await changePlatformRole({
			actorUserId: moderatorId,
			targetUserId: target.id,
			expectedCurrentRole: "user",
			requestedRole: "hr_user",
			requestId: `role-change-${runId}`,
		});
		expect(changed.role).toBe("hr_user");
		await expectPolicyCode(
			changePlatformRole({
				actorUserId: hrUserId,
				targetUserId: target.id,
				expectedCurrentRole: "user",
				requestedRole: "moderator",
				requestId: `role-stale-${runId}`,
			}),
			"POLICY_DENIED",
		);
		await expectPolicyCode(
			changePlatformRole({
				actorUserId: moderatorId,
				targetUserId: moderatorId,
				expectedCurrentRole: "moderator",
				requestedRole: "user",
				requestId: `role-self-${runId}`,
			}),
			"POLICY_DENIED",
		);
	});
});

describe("durable audit and binding constraints", () => {
	test("rolls back a domain mutation when audit persistence fails", async () => {
		const original = await db
			.select({ name: user.name })
			.from(user)
			.where(eq(user.id, plainUserId));
		const eventId = crypto.randomUUID();
		let persistenceFailed = false;
		try {
			await db.transaction(async (transaction) => {
				await transaction
					.update(user)
					.set({ name: "must roll back" })
					.where(eq(user.id, plainUserId));
				const event = {
					eventId,
					eventType: "admin.user.profile_changed" as const,
					outcome: "success" as const,
					reasonCode: "authorized" as const,
					requestId: `audit-rollback-${runId}`,
					actorUserId: adminId,
					targetUserId: plainUserId,
				};
				await recordAdminAuditEvent(transaction, event);
				await recordAdminAuditEvent(transaction, event);
			});
		} catch {
			persistenceFailed = true;
		}
		expect(persistenceFailed).toBe(true);
		const after = await db
			.select({ name: user.name })
			.from(user)
			.where(eq(user.id, plainUserId));
		expect(after[0]?.name).toBe(original[0]?.name);
	});

	test("retains and retries an event after sink failure", async () => {
		const payload = await recordAdminAuditEventInTransaction({
			eventType: "admin.binding.health_checked",
			outcome: "failure",
			reasonCode: "sink_failure",
			requestId: `audit-retry-${runId}`,
			actorUserId: adminId,
			organizationId,
		});
		await deliverAdminAuditOutbox(
			async () => {
				throw new Error("sink unavailable with secret-looking details");
			},
			{ auditEventId: payload.eventId },
		);
		const failed = await db
			.select({ status: adminAuditOutbox.status })
			.from(adminAuditOutbox)
			.where(eq(adminAuditOutbox.auditEventId, payload.eventId));
		expect(failed[0]?.status).toBe("failed");
		const event = await db
			.select({ id: adminAuditEvent.eventId })
			.from(adminAuditEvent)
			.where(eq(adminAuditEvent.eventId, payload.eventId));
		expect(event).toHaveLength(1);
		await deliverAdminAuditOutbox(async () => undefined, {
			now: new Date(Date.now() + 2 * 60 * 60 * 1000),
			auditEventId: payload.eventId,
		});
		const delivered = await db
			.select({ status: adminAuditOutbox.status })
			.from(adminAuditOutbox)
			.where(eq(adminAuditOutbox.auditEventId, payload.eventId));
		expect(delivered[0]?.status).toBe("delivered");
	});

	test("rejects invalid platform and organization role values at the database", async () => {
		await expectDatabaseRejection(
			db.update(user).set({ role: "owner" }).where(eq(user.id, plainUserId)),
		);
		await expectDatabaseRejection(
			db
				.update(member)
				.set({ role: "owner" })
				.where(
					and(
						eq(member.organizationId, organizationId),
						eq(member.userId, adminId),
					),
				),
		);
		await expectDatabaseRejection(
			db
				.update(organization)
				.set({ slug: "Invalid Slug" })
				.where(eq(organization.id, organizationId)),
		);
		await expectDatabaseRejection(
			db.insert(invitation).values({
				id: crypto.randomUUID(),
				organizationId,
				email: `UPPER-${runId}@example.com`,
				role: "user",
				status: "pending",
				expiresAt: new Date(Date.now() + 60_000),
				createdAt: new Date(),
				inviterId: adminId,
			}),
		);
		await expectDatabaseRejection(
			db.insert(invitation).values({
				id: crypto.randomUUID(),
				organizationId,
				email: `invalid-role-${runId}@example.com`,
				role: "owner",
				status: "pending",
				expiresAt: new Date(Date.now() + 60_000),
				createdAt: new Date(),
				inviterId: adminId,
			}),
		);
	});

	test("enforces binding status and secret-reference invariants", async () => {
		const insertBinding = (values: typeof tenantDatabaseBinding.$inferInsert) =>
			db.insert(tenantDatabaseBinding).values(values).execute();
		await insertBinding({
			id: crypto.randomUUID(),
			organizationId,
			applicationId: `erp-pending-${runId}`,
			isolationMode: "dedicated",
			databaseProfile: "postgres-dedicated",
			status: "pending",
		});
		await expectDatabaseRejection(
			insertBinding({
				id: crypto.randomUUID(),
				organizationId,
				applicationId: `erp-active-${runId}`,
				isolationMode: "dedicated",
				databaseProfile: "postgres-dedicated",
				status: "active",
			}),
		);
		await expectDatabaseRejection(
			insertBinding({
				id: crypto.randomUUID(),
				organizationId,
				applicationId: `erp-shared-${runId}`,
				isolationMode: "shared",
				secretRef: "must-not-be-stored",
				databaseProfile: "shared-primary",
				status: "active",
			}),
		);
	});
});
