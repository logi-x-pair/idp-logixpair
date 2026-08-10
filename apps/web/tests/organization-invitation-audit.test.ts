import { beforeAll, describe, expect, test } from "bun:test";
import { auth } from "@krazil-idp/auth";
import { recordAdminAuditEventInTransaction } from "@krazil-idp/auth/admin-audit";
import { readAdminAuditEvents } from "@krazil-idp/auth/admin-audit-read";
import { purgeDeliveredAdminAuditEvents } from "@krazil-idp/auth/admin-audit-retention";
import { createOrganization } from "@krazil-idp/auth/organization-create-service";
import {
	acceptOrganizationInvitation,
	cancelOrganizationInvitation,
	inviteOrganizationMember,
	rejectOrganizationInvitation,
} from "@krazil-idp/auth/organization-invitation-service";
import { OrganizationPolicyError } from "@krazil-idp/auth/organization-policy";
import { PlatformPolicyError } from "@krazil-idp/auth/platform-policy";
import { db } from "@krazil-idp/db";
import {
	adminAuditEvent,
	adminAuditOutbox,
} from "@krazil-idp/db/schema/admin-audit";
import { user } from "@krazil-idp/db/schema/auth";
import { invitation, member } from "@krazil-idp/db/schema/organization";
import { and, eq } from "drizzle-orm";

const runId = Date.now();
const password = "organization-invitation-password-1234";

interface TestUser {
	id: string;
	email: string;
}

let platformAdmin: TestUser;
let organizationAdmin: TestUser;
let secondOrganizationAdmin: TestUser;
let invitee: TestUser;
let secondInvitee: TestUser;
let outsider: TestUser;

async function provision(name: string, role = "user"): Promise<TestUser> {
	const email = `${name}-${runId}@example.com`;
	await auth.api.signUpEmail({ body: { name, email, password } });
	const rows = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, email));
	const id = rows[0]?.id;
	if (!id) throw new Error("Organization invitation test user was not created");
	await db
		.update(user)
		.set({ role, emailVerified: true })
		.where(eq(user.id, id));
	return { id, email };
}

async function provisionUnverified(name: string): Promise<TestUser> {
	const email = `${name}-${runId}@example.com`;
	await auth.api.signUpEmail({ body: { name, email, password } });
	const rows = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, email));
	const id = rows[0]?.id;
	if (!id) throw new Error("Unverified invitation fixture was not created");
	return { id, email };
}

function requestId(label: string): string {
	return `invitation-${label}-${runId}`;
}

async function createTestOrganization(initialAdmin: TestUser, label: string) {
	return createOrganization({
		actorUserId: platformAdmin.id,
		initialAdminUserId: initialAdmin.id,
		name: `Invitation ${label}`,
		slug: `invitation-${label}-${runId}`,
		requestId: requestId(`create-${label}`),
	});
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
	platformAdmin = await provision("invitation-platform-admin", "admin");
	organizationAdmin = await provision("invitation-org-admin");
	secondOrganizationAdmin = await provision("invitation-second-org-admin");
	invitee = await provision("invitation-invitee");
	secondInvitee = await provision("invitation-second-invitee");
	outsider = await provision("invitation-outsider");
});

describe("organization invitation boundaries", () => {
	test("admin invitation acceptance creates the member atomically", async () => {
		const organization = await createTestOrganization(
			organizationAdmin,
			"accept",
		);
		const created = await inviteOrganizationMember({
			actorUserId: organizationAdmin.id,
			organizationId: organization.id,
			email: invitee.email.toUpperCase(),
			role: "user",
			requestId: requestId("accept-invite"),
		});
		expect(created.email).toBe(invitee.email);
		await expectOrganizationPolicyCode(
			inviteOrganizationMember({
				actorUserId: organizationAdmin.id,
				organizationId: organization.id,
				email: invitee.email,
				role: "user",
				requestId: requestId("accept-duplicate"),
			}),
			"CONFLICT",
		);
		const accepted = await acceptOrganizationInvitation({
			actorUserId: invitee.id,
			invitationId: created.id,
			requestId: requestId("accept-resolve"),
		});
		expect(accepted.status).toBe("accepted");
		const memberships = await db
			.select({ role: member.role })
			.from(member)
			.where(
				and(
					eq(member.organizationId, organization.id),
					eq(member.userId, invitee.id),
				),
			);
		expect(memberships).toEqual([{ role: "user" }]);
	});

	test("invitation resolution requires the matching active email", async () => {
		const organization = await createTestOrganization(
			organizationAdmin,
			"email-match",
		);
		const created = await inviteOrganizationMember({
			actorUserId: organizationAdmin.id,
			organizationId: organization.id,
			email: secondInvitee.email,
			role: "moderator",
			requestId: requestId("email-match-invite"),
		});
		await expectOrganizationPolicyCode(
			acceptOrganizationInvitation({
				actorUserId: outsider.id,
				invitationId: created.id,
				requestId: requestId("email-mismatch"),
			}),

			"POLICY_DENIED",
		);
		expect(
			(
				await rejectOrganizationInvitation({
					actorUserId: secondInvitee.id,
					invitationId: created.id,
					requestId: requestId("email-match-reject"),
				})
			).status,
		).toBe("rejected");
	});
	test("invitation acceptance requires verified email ownership", async () => {
		const unverified = await provisionUnverified("invitation-unverified");
		const organization = await createTestOrganization(
			organizationAdmin,
			"unverified-email",
		);
		const created = await inviteOrganizationMember({
			actorUserId: organizationAdmin.id,
			organizationId: organization.id,
			email: unverified.email,
			role: "user",
			requestId: requestId("unverified-invite"),
		});
		await expectOrganizationPolicyCode(
			acceptOrganizationInvitation({
				actorUserId: unverified.id,
				invitationId: created.id,
				requestId: requestId("unverified-accept"),
			}),
			"POLICY_DENIED",
		);
		const pending = await db
			.select({ status: invitation.status })
			.from(invitation)
			.where(eq(invitation.id, created.id));
		expect(pending).toEqual([{ status: "pending" }]);
	});

	test("only organization admins cancel invitations and expired invitations stay unusable", async () => {
		const organization = await createTestOrganization(
			organizationAdmin,
			"cancel-expire",
		);
		const cancelledCandidate = await inviteOrganizationMember({
			actorUserId: organizationAdmin.id,
			organizationId: organization.id,
			email: secondInvitee.email,
			role: "user",
			requestId: requestId("cancel-invite"),
		});
		await expectOrganizationPolicyCode(
			cancelOrganizationInvitation({
				actorUserId: outsider.id,
				organizationId: organization.id,
				invitationId: cancelledCandidate.id,
				requestId: requestId("cancel-denied"),
			}),
			"POLICY_DENIED",
		);
		expect(
			(
				await cancelOrganizationInvitation({
					actorUserId: organizationAdmin.id,
					organizationId: organization.id,
					invitationId: cancelledCandidate.id,
					requestId: requestId("cancel-success"),
				})
			).status,
		).toBe("cancelled");
		const expiredCandidate = await inviteOrganizationMember({
			actorUserId: organizationAdmin.id,
			organizationId: organization.id,
			email: secondInvitee.email,
			role: "user",
			requestId: requestId("expire-invite"),
		});
		await db
			.update(invitation)
			.set({ expiresAt: new Date(0) })
			.where(eq(invitation.id, expiredCandidate.id));
		await expectOrganizationPolicyCode(
			acceptOrganizationInvitation({
				actorUserId: secondInvitee.id,
				invitationId: expiredCandidate.id,
				requestId: requestId("expire-resolve"),
			}),
			"INVALID_INPUT",
		);
		const rows = await db
			.select({ status: invitation.status })
			.from(invitation)
			.where(eq(invitation.id, expiredCandidate.id));
		expect(rows[0]?.status).toBe("expired");
		const resolutionExpiryEvents = await db
			.select({ outcome: adminAuditEvent.outcome })
			.from(adminAuditEvent)
			.where(
				and(
					eq(adminAuditEvent.eventType, "admin.member.invitation_expired"),
					eq(adminAuditEvent.targetId, expiredCandidate.id),
				),
			);
		expect(resolutionExpiryEvents).toEqual([{ outcome: "success" }]);
		const staleCandidate = await inviteOrganizationMember({
			actorUserId: organizationAdmin.id,
			organizationId: organization.id,
			email: invitee.email,
			role: "user",
			requestId: requestId("stale-invite"),
		});
		await db
			.update(invitation)
			.set({ expiresAt: new Date(0) })
			.where(eq(invitation.id, staleCandidate.id));
		const replacement = await inviteOrganizationMember({
			actorUserId: organizationAdmin.id,
			organizationId: organization.id,
			email: invitee.email,
			role: "user",
			requestId: requestId("stale-replaced"),
		});
		expect(replacement.status).toBe("pending");
		const staleRows = await db
			.select({ status: invitation.status })
			.from(invitation)
			.where(eq(invitation.id, staleCandidate.id));
		expect(staleRows).toEqual([{ status: "expired" }]);
		const reconciliationExpiryEvents = await db
			.select({ outcome: adminAuditEvent.outcome })
			.from(adminAuditEvent)
			.where(
				and(
					eq(adminAuditEvent.eventType, "admin.member.invitation_expired"),
					eq(adminAuditEvent.targetId, staleCandidate.id),
				),
			);
		expect(reconciliationExpiryEvents).toEqual([{ outcome: "success" }]);
	});

	test("pending invitation count is bounded per organization", async () => {
		const organization = await createTestOrganization(
			organizationAdmin,
			"invite-limit",
		);
		const now = Date.now();
		await db.insert(invitation).values(
			Array.from({ length: 100 }, (_, index) => ({
				id: crypto.randomUUID(),
				organizationId: organization.id,
				email: `pending-${runId}-${index}@example.com`,
				role: "user",
				status: "pending",
				expiresAt: new Date(now + 60 * 60 * 1000),
				createdAt: new Date(now),
				inviterId: organizationAdmin.id,
			})),
		);
		await expectOrganizationPolicyCode(
			inviteOrganizationMember({
				actorUserId: organizationAdmin.id,
				organizationId: organization.id,
				email: outsider.email,
				role: "user",
				requestId: requestId("invite-limit-rejected"),
			}),
			"CONFLICT",
		);
	});

	test("concurrent duplicate invitations admit exactly one pending record", async () => {
		const organization = await createTestOrganization(
			organizationAdmin,
			"invite-race",
		);
		const results = await Promise.allSettled([
			inviteOrganizationMember({
				actorUserId: organizationAdmin.id,
				organizationId: organization.id,
				email: invitee.email,
				role: "user",
				requestId: requestId("invite-race-a"),
			}),
			inviteOrganizationMember({
				actorUserId: organizationAdmin.id,
				organizationId: organization.id,
				email: invitee.email,
				role: "user",
				requestId: requestId("invite-race-b"),
			}),
		]);
		expect(
			results.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		expect(
			results.filter((result) => result.status === "rejected"),
		).toHaveLength(1);
	});
});

describe("admin audit read and retention boundaries", () => {
	test("scoped audit reads and invitations share organization-first lock order", async () => {
		const organization = await createTestOrganization(
			organizationAdmin,
			"audit-lock-order",
		);
		for (let index = 0; index < 10; index += 1) {
			const results = await Promise.allSettled([
				readAdminAuditEvents({
					actorUserId: organizationAdmin.id,
					organizationId: organization.id,
					requestId: requestId(`audit-lock-read-${index}`),
					pageSize: 10,
				}),
				inviteOrganizationMember({
					actorUserId: organizationAdmin.id,
					organizationId: organization.id,
					email: `audit-lock-${runId}-${index}@example.com`,
					role: "user",
					requestId: requestId(`audit-lock-invite-${index}`),
				}),
			]);
			for (const result of results) {
				expect(result.status).toBe("fulfilled");
				if (result.status === "rejected") throw result.reason;
			}
		}
	});

	test("platform admins can read historical events for a missing organization", async () => {
		const historicalOrganizationId = `historical-org-${runId}`;
		const historicalRequestId = requestId("historical-org-event");
		const event = await recordAdminAuditEventInTransaction({
			eventType: "admin.organization.archived",
			outcome: "success",
			reasonCode: "authorized",
			requestId: historicalRequestId,
			actorUserId: platformAdmin.id,
			organizationId: historicalOrganizationId,
		});
		const page = await readAdminAuditEvents({
			actorUserId: platformAdmin.id,
			organizationId: historicalOrganizationId,
			requestId: requestId("historical-org-read"),
			requestIdFilter: historicalRequestId,
		});
		expect(page.items.map((item) => item.eventId)).toEqual([event.eventId]);
	});

	test("organization admins receive only their organization's mutation events", async () => {
		const first = await createTestOrganization(
			organizationAdmin,
			"audit-first",
		);
		await createTestOrganization(secondOrganizationAdmin, "audit-second");
		const page = await readAdminAuditEvents({
			actorUserId: organizationAdmin.id,
			organizationId: first.id,
			requestId: requestId("audit-org-read"),
			pageSize: 100,
		});
		expect(page.items.length).toBeGreaterThan(0);
		expect(page.items.every((event) => event.organizationId === first.id)).toBe(
			true,
		);
		expect(
			page.items.every(
				(event) =>
					event.eventType.startsWith("admin.organization.") ||
					event.eventType.startsWith("admin.member."),
			),
		).toBe(true);
	});

	test("non-admin audit reads are denied and recorded", async () => {
		let rejection: unknown;
		try {
			await readAdminAuditEvents({
				actorUserId: outsider.id,
				requestId: requestId("audit-denied"),
			});
		} catch (error) {
			rejection = error;
		}
		expect(rejection).toBeInstanceOf(PlatformPolicyError);
		expect((rejection as PlatformPolicyError).code).toBe("POLICY_DENIED");
		const deniedRows = await db
			.select({ outcome: adminAuditEvent.outcome })
			.from(adminAuditEvent)
			.where(eq(adminAuditEvent.requestId, requestId("audit-denied")));
		expect(deniedRows).toEqual([{ outcome: "denied" }]);
	});

	test("platform audit reads support bounded filters and record access", async () => {
		await Promise.all(
			Array.from({ length: 6 }, (_, index) =>
				recordAdminAuditEventInTransaction({
					eventType: "admin.organization.created",
					outcome: "success",
					reasonCode: "authorized",
					requestId: requestId(`audit-cursor-fixture-${index}`),
					actorUserId: platformAdmin.id,
				}),
			),
		);
		const page = await readAdminAuditEvents({
			actorUserId: platformAdmin.id,
			requestId: requestId("audit-platform-read"),
			eventTypes: ["admin.organization.created"],
			outcome: "success",
			pageSize: 5,
		});
		expect(page.pageSize).toBe(5);
		expect(page.items.length).toBeLessThanOrEqual(5);
		expect(
			page.items.every(
				(event) => event.eventType === "admin.organization.created",
			),
		).toBe(true);
		expect(page.nextCursor).toBeDefined();
		const nextPage = await readAdminAuditEvents({
			actorUserId: platformAdmin.id,
			requestId: requestId("audit-platform-read-next"),
			eventTypes: ["admin.organization.created"],
			outcome: "success",
			cursor: page.nextCursor,
			pageSize: 5,
		});
		const firstPageIds = new Set(page.items.map((event) => event.eventId));
		expect(
			nextPage.items.every((event) => !firstPageIds.has(event.eventId)),
		).toBe(true);
		const metadataRequestId = requestId("audit-metadata-event");
		await recordAdminAuditEventInTransaction({
			eventType: "admin.organization.updated",
			outcome: "success",
			reasonCode: "authorized",
			requestId: metadataRequestId,
			actorUserId: platformAdmin.id,
			metadata: { scope: "metadata-check", result_count: 3 },
		});
		const metadataPage = await readAdminAuditEvents({
			actorUserId: platformAdmin.id,
			requestId: requestId("audit-metadata-read"),
			requestIdFilter: metadataRequestId,
			eventTypes: ["admin.organization.updated"],
		});
		expect(metadataPage.items[0]?.metadata).toEqual({
			scope: "metadata-check",
			result_count: 3,
		});
		const readEvents = await db
			.select({ outcome: adminAuditEvent.outcome })
			.from(adminAuditEvent)
			.where(eq(adminAuditEvent.requestId, requestId("audit-platform-read")));
		expect(readEvents).toEqual([{ outcome: "success" }]);
	});

	test("retention deletes only delivered audit events older than the cutoff", async () => {
		const delivered = await recordAdminAuditEventInTransaction({
			eventType: "admin.organization.updated",
			outcome: "success",
			reasonCode: "authorized",
			requestId: requestId("retention-delivered"),
			actorUserId: platformAdmin.id,
		});
		const pending = await recordAdminAuditEventInTransaction({
			eventType: "admin.organization.updated",
			outcome: "success",
			reasonCode: "authorized",
			requestId: requestId("retention-pending"),
			actorUserId: platformAdmin.id,
		});
		const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
		await db
			.update(adminAuditEvent)
			.set({ occurredAt: oldDate })
			.where(eq(adminAuditEvent.eventId, delivered.eventId));
		await db
			.update(adminAuditEvent)
			.set({ occurredAt: oldDate })
			.where(eq(adminAuditEvent.eventId, pending.eventId));
		await db
			.update(adminAuditOutbox)
			.set({ status: "delivered", deliveredAt: new Date() })
			.where(eq(adminAuditOutbox.auditEventId, delivered.eventId));
		const result = await purgeDeliveredAdminAuditEvents({
			actorUserId: platformAdmin.id,
			requestId: requestId("retention-purge"),
			retentionDays: 30,
			batchSize: 100,
		});
		expect(result.deleted).toBeGreaterThanOrEqual(1);
		expect(
			await db
				.select({ id: adminAuditEvent.eventId })
				.from(adminAuditEvent)
				.where(eq(adminAuditEvent.eventId, delivered.eventId)),
		).toHaveLength(0);
		expect(
			await db
				.select({ id: adminAuditEvent.eventId })
				.from(adminAuditEvent)
				.where(eq(adminAuditEvent.eventId, pending.eventId)),
		).toHaveLength(1);
	});
});
