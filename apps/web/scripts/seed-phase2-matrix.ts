/**
 * Seeds the deterministic Phase-2 organization/role fixture matrix for the
 * localhost E2E harness (acceptance-matrix specs). The E2E database is
 * recreated fresh on every bootstrap run (scripts/setup-test-db.ts), so
 * fixture emails/slugs are fixed by contract and never need a run suffix.
 *
 * Creates:
 *   - seven fixture users sharing ONE password, all email-verified:
 *       phase2-org-admin@localhost.test     (platform role user)
 *       phase2-org-mod@localhost.test       (platform role user)
 *       phase2-org-member@localhost.test    (platform role user)
 *       phase2-invited@localhost.test       (platform role user, no membership)
 *       phase2-platform-mod@localhost.test  (platform role moderator)
 *       phase2-ban-target@localhost.test    (platform role user, ban test target)
 *       phase2-platform-hr@localhost.test   (platform role hr_user)
 *   - "Phase 2 Matrix Org" (slug phase2-matrix) with org-admin as initial
 *     admin, plus org-mod (org role moderator) and org-member (org role user);
 *   - "Phase 2 Second Org" (slug phase2-second) with only org-admin;
 *   - one pending invitation in the matrix org for phase2-invited@localhost.test
 *     (org role user), invited by the org-admin.
 *
 * Org/member/invitation fixtures go through the in-process policy services or
 * direct drizzle inserts — the server guards block raw Better Auth
 * organization mutation endpoints over HTTP.
 *
 * Run from apps/web (so .env is picked up):
 *   bun run scripts/seed-phase2-matrix.ts [--json]
 *
 * --json keeps stdout a strict machine channel: exactly one JSON object (the
 * fixture contract consumed by apps/test-rp/e2e-bootstrap.ts). Every
 * operational log is redirected to stderr before any auth work begins.
 */
import { auth } from "@krazil-idp/auth";
import { createOrganization } from "@krazil-idp/auth/organization-create-service";
import { inviteOrganizationMember } from "@krazil-idp/auth/organization-invitation-service";
import { db } from "@krazil-idp/db";
import { user } from "@krazil-idp/db/schema/auth";
import { member } from "@krazil-idp/db/schema/organization";
import { env } from "@krazil-idp/env/server";
import { APIError } from "better-auth";
import { eq } from "drizzle-orm";

import { assertDisposableDatabaseTarget } from "../../../scripts/test-environment";

const FIXTURE_PASSWORD = "phase2-fixture-password-2026";
const ORG_ADMIN_EMAIL = "phase2-org-admin@localhost.test";
const ORG_MOD_EMAIL = "phase2-org-mod@localhost.test";
const ORG_MEMBER_EMAIL = "phase2-org-member@localhost.test";
const INVITED_EMAIL = "phase2-invited@localhost.test";
const PLATFORM_MOD_EMAIL = "phase2-platform-mod@localhost.test";
const PLATFORM_HR_EMAIL = "phase2-platform-hr@localhost.test";
const BAN_TARGET_EMAIL = "phase2-ban-target@localhost.test";

interface FixtureUser {
	name: string;
	email: string;
	/** Platform role assigned after proving sign-up (role is never sign-up input). */
	role: "user" | "moderator" | "hr_user";
}

const FIXTURE_USERS: FixtureUser[] = [
	{ name: "Phase 2 Org Admin", email: ORG_ADMIN_EMAIL, role: "user" },
	{ name: "Phase 2 Org Moderator", email: ORG_MOD_EMAIL, role: "user" },
	{ name: "Phase 2 Org Member", email: ORG_MEMBER_EMAIL, role: "user" },
	{ name: "Phase 2 Invited", email: INVITED_EMAIL, role: "user" },
	{
		name: "Phase 2 Platform Moderator",
		email: PLATFORM_MOD_EMAIL,
		role: "moderator",
	},
	{ name: "Phase 2 Platform HR", email: PLATFORM_HR_EMAIL, role: "hr_user" },
	{ name: "Phase 2 Ban Target", email: BAN_TARGET_EMAIL, role: "user" },
];

function requestId(label: string): string {
	return `seed-phase2-${label}-${crypto.randomUUID()}`;
}

/** Looks up a fixture user id, creating the account (tolerating re-runs). */
async function provisionUser(fixture: FixtureUser): Promise<string> {
	try {
		await auth.api.signUpEmail({
			body: {
				name: fixture.name,
				email: fixture.email,
				password: FIXTURE_PASSWORD,
			},
		});
		console.log(`Created fixture user ${fixture.email}`);
	} catch (error) {
		const exists =
			error instanceof APIError &&
			error.body?.code?.startsWith("USER_ALREADY_EXISTS");
		if (!exists) throw error;
		console.log(`Fixture user ${fixture.email} already exists — reusing.`);
	}
	const rows = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, fixture.email));
	const id = rows[0]?.id;
	if (!id) throw new Error(`Fixture user ${fixture.email} was not created`);
	await db
		.update(user)
		.set({ role: fixture.role, emailVerified: true })
		.where(eq(user.id, id));
	return id;
}

// Fail closed before ANY auth/DB work: this seed provisions known-password
// operator accounts, so it may only target the dedicated disposable database.
assertDisposableDatabaseTarget(process.env);

const asJson = process.argv.includes("--json");
if (asJson) {
	// Keep stdout a strict machine channel; operational/audit logs remain visible on stderr.
	console.log = (...data: unknown[]) => console.error(...data);
}

// (a) Fixture users: shared password, email-verified, platform roles.
const userIds: Record<string, string> = {};
for (const fixture of FIXTURE_USERS) {
	userIds[fixture.email] = await provisionUser(fixture);
}

// (b) Platform admin actor id (createOrganization authorizes platform admins).
const adminEmail = env.IDP_ADMIN_EMAIL?.toLowerCase();
const adminRows = await db
	.select({ id: user.id, role: user.role })
	.from(user)
	.where(eq(user.email, adminEmail ?? ""));
const platformAdmin = adminRows[0];
if (!adminEmail || !platformAdmin || platformAdmin.role !== "admin") {
	throw new Error(
		"Phase 2 matrix seeding requires a provisioned platform admin (IDP_ADMIN_EMAIL). Run seed:admin first.",
	);
}

// (c) Organizations, each with org-admin as initial admin.
const orgAdminId = userIds[ORG_ADMIN_EMAIL];
if (!orgAdminId) throw new Error(`Missing fixture user ${ORG_ADMIN_EMAIL}`);
const matrixOrg = await createOrganization({
	actorUserId: platformAdmin.id,
	initialAdminUserId: orgAdminId,
	name: "Phase 2 Matrix Org",
	slug: "phase2-matrix",
	requestId: requestId("matrix-org"),
});
console.log(`Created Phase 2 Matrix Org (${matrixOrg.id})`);
const secondOrg = await createOrganization({
	actorUserId: platformAdmin.id,
	initialAdminUserId: orgAdminId,
	name: "Phase 2 Second Org",
	slug: "phase2-second",
	requestId: requestId("second-org"),
});
console.log(`Created Phase 2 Second Org (${secondOrg.id})`);

// (d) Non-admin members of the matrix org via direct drizzle inserts
// (membership role mutations have no privileged in-process service surface).
const now = new Date();
const orgModId = userIds[ORG_MOD_EMAIL];
const orgMemberId = userIds[ORG_MEMBER_EMAIL];
if (!orgModId || !orgMemberId) {
	throw new Error("Missing matrix org fixture users");
}
await db.insert(member).values([
	{
		id: crypto.randomUUID(),
		organizationId: matrixOrg.id,
		userId: orgModId,
		role: "moderator",
		createdAt: now,
	},
	{
		id: crypto.randomUUID(),
		organizationId: matrixOrg.id,
		userId: orgMemberId,
		role: "user",
		createdAt: now,
	},
]);
console.log("Inserted matrix org members (moderator, user)");

// (e) One pending invitation for the invited fixture user (role user).
const invitation = await inviteOrganizationMember({
	actorUserId: orgAdminId,
	organizationId: matrixOrg.id,
	email: INVITED_EMAIL,
	role: "user",
	requestId: requestId("matrix-invitation"),
});
console.log(
	`Created pending invitation ${invitation.id} for ${INVITED_EMAIL} (${invitation.status})`,
);

if (asJson) {
	process.stdout.write(
		`${JSON.stringify(
			{
				password: FIXTURE_PASSWORD,
				orgId: matrixOrg.id,
				secondOrgId: secondOrg.id,
				orgAdminEmail: ORG_ADMIN_EMAIL,
				orgModEmail: ORG_MOD_EMAIL,
				orgMemberEmail: ORG_MEMBER_EMAIL,
				invitedEmail: INVITED_EMAIL,
				invitationId: invitation.id,
				platformModEmail: PLATFORM_MOD_EMAIL,
				platformHrEmail: PLATFORM_HR_EMAIL,
				banTargetEmail: BAN_TARGET_EMAIL,
			},
			null,
			2,
		)}\n`,
	);
} else {
	console.log(`Fixture password: ${FIXTURE_PASSWORD}`);
}
process.exit(0);
