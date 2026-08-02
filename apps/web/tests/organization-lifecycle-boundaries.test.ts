import { beforeAll, describe, expect, test } from "bun:test";
import { auth } from "@krazil-idp/auth";
import { createOrganization } from "@krazil-idp/auth/organization-create-service";
import {
	changeOrganizationStatus,
	type OrganizationProfile,
} from "@krazil-idp/auth/organization-lifecycle-service";
import {
	changeOrganizationMemberRole,
	removeOrganizationMember,
} from "@krazil-idp/auth/organization-member-service";
import { addOrganizationMember } from "@krazil-idp/auth/organization-membership-service";
import { OrganizationPolicyError } from "@krazil-idp/auth/organization-policy";
import {
	readOrganizationProfile,
	updateOrganizationProfile,
} from "@krazil-idp/auth/organization-profile-service";
import { db } from "@krazil-idp/db";
import { adminAuditEvent } from "@krazil-idp/db/schema/admin-audit";
import { user } from "@krazil-idp/db/schema/auth";
import { member } from "@krazil-idp/db/schema/organization";
import { and, eq } from "drizzle-orm";

const runId = Date.now();
const password = "organization-lifecycle-password-1234";

let platformAdminId: string;
let primaryAdminId: string;
let secondaryAdminId: string;
let moderatorId: string;
let ordinaryUserId: string;
let outsiderId: string;

async function provision(name: string, role = "user"): Promise<string> {
	const email = `${name}-${runId}@example.com`;
	await auth.api.signUpEmail({ body: { name, email, password } });
	const rows = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, email));
	const id = rows[0]?.id;
	if (!id) throw new Error("Organization lifecycle test user was not created");
	await db
		.update(user)
		.set({ role, emailVerified: true })
		.where(eq(user.id, id));
	return id;
}

function requestId(label: string): string {
	return `lifecycle-${label}-${runId}`;
}

async function createTestOrganization(
	initialAdminUserId: string,
	label: string,
): Promise<OrganizationProfile> {
	return createOrganization({
		actorUserId: platformAdminId,
		initialAdminUserId,
		name: `Lifecycle ${label}`,
		slug: `lifecycle-${label}-${runId}`,
		metadata: { test_run: runId },
		requestId: requestId(`create-${label}`),
	});
}

async function expectPolicyCode(
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
	platformAdminId = await provision("lifecycle-platform-admin", "admin");
	primaryAdminId = await provision("lifecycle-primary-admin");
	secondaryAdminId = await provision("lifecycle-secondary-admin");
	moderatorId = await provision("lifecycle-moderator");
	ordinaryUserId = await provision("lifecycle-user");
	outsiderId = await provision("lifecycle-outsider");
});

describe("organization lifecycle service boundaries", () => {
	test("platform admin creates organizations atomically with an initial admin and audit", async () => {
		const organization = await createTestOrganization(primaryAdminId, "create");
		const memberships = await db
			.select({ role: member.role })
			.from(member)
			.where(
				and(
					eq(member.organizationId, organization.id),
					eq(member.userId, primaryAdminId),
				),
			);
		expect(memberships).toEqual([{ role: "admin" }]);
		const auditRows = await db
			.select({ outcome: adminAuditEvent.outcome })
			.from(adminAuditEvent)
			.where(
				and(
					eq(adminAuditEvent.organizationId, organization.id),
					eq(adminAuditEvent.eventType, "admin.organization.created"),
				),
			);
		expect(auditRows.some((row) => row.outcome === "success")).toBe(true);
	});

	test("concurrent duplicate slug creation admits exactly one organization", async () => {
		const slug = `lifecycle-create-race-${runId}`;
		const results = await Promise.allSettled([
			createOrganization({
				actorUserId: platformAdminId,
				initialAdminUserId: primaryAdminId,
				name: "Lifecycle Create Race A",
				slug,
				requestId: requestId("create-race-a"),
			}),
			createOrganization({
				actorUserId: platformAdminId,
				initialAdminUserId: secondaryAdminId,
				name: "Lifecycle Create Race B",
				slug,
				requestId: requestId("create-race-b"),
			}),
		]);
		expect(
			results.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		const rejected = results.find((result) => result.status === "rejected");
		expect(rejected?.status).toBe("rejected");
		if (rejected?.status === "rejected") {
			expect(rejected.reason).toBeInstanceOf(OrganizationPolicyError);
			expect((rejected.reason as OrganizationPolicyError).code).toBe(
				"CONFLICT",
			);
		}
	});

	test("profile updates enforce moderator field limits and access-scoped reads", async () => {
		const organization = await createTestOrganization(
			primaryAdminId,
			"profile",
		);
		await addOrganizationMember({
			actorUserId: primaryAdminId,
			organizationId: organization.id,
			targetUserId: moderatorId,
			requestedRole: "moderator",
			requestId: requestId("profile-add-moderator"),
		});
		const updated = await updateOrganizationProfile({
			actorUserId: moderatorId,
			organizationId: organization.id,
			name: "Lifecycle Profile Updated",
			logo: "https://example.com/logo.png",
			requestId: requestId("profile-update"),
		});
		expect(updated.name).toBe("Lifecycle Profile Updated");
		await expectPolicyCode(
			updateOrganizationProfile({
				actorUserId: moderatorId,
				organizationId: organization.id,
				slug: `forbidden-moderator-slug-${runId}`,
				requestId: requestId("profile-forbidden-slug"),
			}),
			"POLICY_DENIED",
		);
		await expectPolicyCode(
			readOrganizationProfile({
				actorUserId: outsiderId,
				organizationId: organization.id,
			}),
			"POLICY_DENIED",
		);
		expect(
			(
				await readOrganizationProfile({
					actorUserId: platformAdminId,
					organizationId: organization.id,
				})
			).id,
		).toBe(organization.id);
	});

	test("suspension blocks organization policy and archive is terminal", async () => {
		const organization = await createTestOrganization(primaryAdminId, "status");
		const suspended = await changeOrganizationStatus({
			actorUserId: platformAdminId,
			organizationId: organization.id,
			expectedStatus: "active",
			requestedStatus: "suspended",
			requestId: requestId("suspend"),
		});
		expect(suspended.status).toBe("suspended");
		await expectPolicyCode(
			addOrganizationMember({
				actorUserId: primaryAdminId,
				organizationId: organization.id,
				targetUserId: ordinaryUserId,
				requestedRole: "user",
				requestId: requestId("suspended-add"),
			}),
			"POLICY_DENIED",
		);
		await expectPolicyCode(
			readOrganizationProfile({
				actorUserId: primaryAdminId,
				organizationId: organization.id,
			}),
			"POLICY_DENIED",
		);
		expect(
			(
				await readOrganizationProfile({
					actorUserId: platformAdminId,
					organizationId: organization.id,
				})
			).status,
		).toBe("suspended");
		await changeOrganizationStatus({
			actorUserId: platformAdminId,
			organizationId: organization.id,
			expectedStatus: "suspended",
			requestedStatus: "active",
			requestId: requestId("reactivate"),
		});
		await changeOrganizationStatus({
			actorUserId: platformAdminId,
			organizationId: organization.id,
			expectedStatus: "active",
			requestedStatus: "archived",
			requestId: requestId("archive"),
		});
		await expectPolicyCode(
			changeOrganizationStatus({
				actorUserId: platformAdminId,
				organizationId: organization.id,
				expectedStatus: "archived",
				requestedStatus: "active",
				requestId: requestId("unarchive"),
			}),
			"INVALID_INPUT",
		);
	});

	test("status and membership mutations complete without lock-order deadlock", async () => {
		const organization = await createTestOrganization(
			primaryAdminId,
			"lock-order",
		);
		await addOrganizationMember({
			actorUserId: primaryAdminId,
			organizationId: organization.id,
			targetUserId: moderatorId,
			requestedRole: "moderator",
			requestId: requestId("lock-order-add"),
		});
		const concurrent = Promise.allSettled([
			changeOrganizationStatus({
				actorUserId: platformAdminId,
				organizationId: organization.id,
				expectedStatus: "active",
				requestedStatus: "suspended",
				requestId: requestId("lock-order-status"),
			}),
			changeOrganizationMemberRole({
				actorUserId: primaryAdminId,
				organizationId: organization.id,
				targetUserId: moderatorId,
				expectedCurrentRole: "moderator",
				requestedRole: "user",
				requestId: requestId("lock-order-member"),
			}),
		]);
		const results = await concurrent;
		const statusResult = results[0];
		expect(statusResult?.status).toBe("fulfilled");
		if (statusResult?.status === "rejected") throw statusResult.reason;
		const memberResult = results[1];
		if (memberResult?.status === "rejected") {
			expect(memberResult.reason).toBeInstanceOf(OrganizationPolicyError);
			expect((memberResult.reason as OrganizationPolicyError).code).toBe(
				"POLICY_DENIED",
			);
		} else {
			expect(memberResult?.status).toBe("fulfilled");
		}
	});

	test("member hierarchy permits moderator removal only for ordinary users", async () => {
		const organization = await createTestOrganization(
			primaryAdminId,
			"hierarchy",
		);
		await addOrganizationMember({
			actorUserId: primaryAdminId,
			organizationId: organization.id,
			targetUserId: moderatorId,
			requestedRole: "moderator",
			requestId: requestId("hierarchy-add-mod"),
		});
		await addOrganizationMember({
			actorUserId: primaryAdminId,
			organizationId: organization.id,
			targetUserId: ordinaryUserId,
			requestedRole: "user",
			requestId: requestId("hierarchy-add-user"),
		});
		await removeOrganizationMember({
			actorUserId: moderatorId,
			organizationId: organization.id,
			targetUserId: ordinaryUserId,
			expectedCurrentRole: "user",
			requestId: requestId("hierarchy-remove-user"),
		});
		await expectPolicyCode(
			removeOrganizationMember({
				actorUserId: moderatorId,
				organizationId: organization.id,
				targetUserId: primaryAdminId,
				expectedCurrentRole: "admin",
				requestId: requestId("hierarchy-remove-admin"),
			}),
			"POLICY_DENIED",
		);
	});

	test("concurrent admin demotions preserve one active organization admin", async () => {
		const organization = await createTestOrganization(
			primaryAdminId,
			"last-admin-race",
		);
		await addOrganizationMember({
			actorUserId: primaryAdminId,
			organizationId: organization.id,
			targetUserId: secondaryAdminId,
			requestedRole: "admin",
			requestId: requestId("last-admin-add-second"),
		});
		const results = await Promise.allSettled([
			changeOrganizationMemberRole({
				actorUserId: primaryAdminId,
				organizationId: organization.id,
				targetUserId: primaryAdminId,
				expectedCurrentRole: "admin",
				requestedRole: "user",
				requestId: requestId("last-admin-demote-first"),
			}),
			changeOrganizationMemberRole({
				actorUserId: secondaryAdminId,
				organizationId: organization.id,
				targetUserId: secondaryAdminId,
				expectedCurrentRole: "admin",
				requestedRole: "user",
				requestId: requestId("last-admin-demote-second"),
			}),
		]);
		expect(
			results.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		const activeAdmins = await db
			.select({ role: member.role })
			.from(member)
			.where(
				and(
					eq(member.organizationId, organization.id),
					eq(member.role, "admin"),
				),
			);
		expect(activeAdmins).toHaveLength(1);
	});
});
