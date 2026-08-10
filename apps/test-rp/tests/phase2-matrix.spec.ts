import { expect, type Locator, type Page, test } from "@playwright/test";

const IDP_ORIGIN = "http://localhost:3000";

const envKeys = [
	"E2E_PHASE2_PASSWORD",
	"E2E_PHASE2_ORG_ID",
	"E2E_PHASE2_SECOND_ORG_ID",
	"E2E_PHASE2_ORG_ADMIN_EMAIL",
	"E2E_PHASE2_ORG_MOD_EMAIL",
	"E2E_PHASE2_ORG_MEMBER_EMAIL",
	"E2E_PHASE2_INVITED_EMAIL",
	"E2E_PHASE2_INVITATION_ID",
	"E2E_PHASE2_PLATFORM_MOD_EMAIL",
	"E2E_PHASE2_PLATFORM_HR_EMAIL",
	"E2E_PHASE2_BAN_TARGET_EMAIL",
] as const;

const env: Record<(typeof envKeys)[number], string> = {} as never;
for (const key of envKeys) {
	const value = process.env[key];
	if (!value) {
		throw new Error(`${key} is required in apps/test-rp/.env`);
	}
	env[key] = value;
}

async function signIn(page: Page, email: string, password: string) {
	await page.goto(`${IDP_ORIGIN}/sign-in`);
	await page.getByLabel("Email").fill(email);
	await page.getByLabel("Password").fill(password);
	await page.getByRole("button", { name: "Sign in" }).click();
	// Wait for the session cookie to commit and the client redirect to leave
	// the auth page; a following goto otherwise races the cookie and gets
	// bounced back to /sign-in with no session.
	await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), {
		timeout: 15_000,
	});
}

async function signInAsOrgAdmin(page: Page) {
	await signIn(page, env.E2E_PHASE2_ORG_ADMIN_EMAIL, env.E2E_PHASE2_PASSWORD);
}

async function openOrganizationAdministration(page: Page) {
	await page.goto(`${IDP_ORIGIN}/admin/organizations/${env.E2E_PHASE2_ORG_ID}`);
}

function memberRow(page: Page, email: string): Locator {
	return page
		.getByRole("row")
		.filter({ has: page.getByText(email, { exact: true }) });
}

test("org admin manages the matrix organization", async ({ page }) => {
	await signInAsOrgAdmin(page);
	await openOrganizationAdministration(page);

	for (const email of [
		env.E2E_PHASE2_ORG_ADMIN_EMAIL,
		env.E2E_PHASE2_ORG_MOD_EMAIL,
		env.E2E_PHASE2_ORG_MEMBER_EMAIL,
	]) {
		await expect(page.getByText(email, { exact: true }).first()).toBeVisible();
	}

	const invitation = page
		.locator("section")
		.filter({ hasText: "Invitations" })
		.locator("div")
		.filter({ hasText: env.E2E_PHASE2_INVITED_EMAIL })
		.filter({ hasText: "pending" })
		.first();
	await expect(invitation).toBeVisible();

	const newInvitationEmail = `phase2-matrix-${Date.now()}@example.com`;
	await page.getByLabel("Email").fill(newInvitationEmail);
	await page.locator("#invite-role").selectOption("user");
	await page.getByRole("button", { name: "Create invitation" }).click();

	await expect(page.getByRole("status")).toContainText("Invitation created");
	await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
	const shareLink = page.getByRole("textbox", {
		name: "Invitation share link",
	});
	await expect(shareLink).toBeVisible();
	await expect
		.poll(async () => (await shareLink.inputValue()) ?? "")
		.toMatch(/\/organizations\/invitations\//);

	const created = page
		.locator("section")
		.filter({ hasText: "Invitations" })
		.locator("div")
		.filter({ hasText: newInvitationEmail })
		.filter({ hasText: "pending" })
		.first();
	await expect(created).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Cancel invitation" }).first(),
	).toBeVisible();
});

test("org moderator gets bounded administration controls", async ({ page }) => {
	await signIn(page, env.E2E_PHASE2_ORG_MOD_EMAIL, env.E2E_PHASE2_PASSWORD);
	await openOrganizationAdministration(page);

	await expect(
		page.getByText("Invite member", { exact: true }),
	).not.toBeVisible();
	await expect(
		page.getByRole("button", { name: "Create invitation" }),
	).toHaveCount(0);

	await expect(
		page.getByLabel(`Change ${env.E2E_PHASE2_ORG_MEMBER_EMAIL} role`),
	).toHaveCount(0);
	await expect(
		page.getByLabel(`Change ${env.E2E_PHASE2_ORG_MOD_EMAIL} role`),
	).toHaveCount(0);

	await expect(
		memberRow(page, env.E2E_PHASE2_ORG_MEMBER_EMAIL).getByRole("button", {
			name: "Remove member",
		}),
	).toBeVisible();
	await expect(
		memberRow(page, env.E2E_PHASE2_ORG_ADMIN_EMAIL).getByRole("button", {
			name: "Remove member",
		}),
	).toHaveCount(0);

	const profile = page.getByText("Organization profile", { exact: true });
	await expect(profile).toBeVisible();
	await expect(page.locator("#organization-profile-slug")).toHaveCount(0);
});

test("ordinary org member is redirected away from organization administration", async ({
	page,
}) => {
	await signIn(page, env.E2E_PHASE2_ORG_MEMBER_EMAIL, env.E2E_PHASE2_PASSWORD);
	await page.goto(`${IDP_ORIGIN}/admin/organizations/${env.E2E_PHASE2_ORG_ID}`);
	await expect(page).toHaveURL(`${IDP_ORIGIN}/organizations`);
	await expect(
		page.getByRole("heading", { name: "Choose an organization" }),
	).toBeVisible();
	await expect(
		page.getByText("Organization administration", { exact: true }),
	).not.toBeVisible();
});

test("platform moderators can ban accounts; HR users cannot", async ({
	page,
}) => {
	await signIn(
		page,
		env.E2E_PHASE2_PLATFORM_MOD_EMAIL,
		env.E2E_PHASE2_PASSWORD,
	);
	await page.goto(`${IDP_ORIGIN}/admin/platform/users`);

	// Target the dedicated ban fixture: the user list is keyed by ascending
	// random ids, so "first phase2-* row" would ban a nondeterministic account
	// that later tests still need.
	const target = page
		.locator("tr")
		.filter({ hasText: env.E2E_PHASE2_BAN_TARGET_EMAIL })
		.first();
	await expect(target).toBeVisible();
	await target.getByRole("button", { name: "Ban account" }).click();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Ban account" })
		.click();
	await expect(page.getByRole("status")).toContainText(
		"Account access updated",
	);
	await expect(
		target.getByRole("button", { name: "Restore access" }),
	).toBeVisible();

	await page.getByRole("button", { name: "Open user menu" }).click();
	await page.getByRole("menuitem", { name: "Sign out" }).click();
	await expect(page).toHaveURL(/localhost:3000\/sign-in/);

	await signIn(page, env.E2E_PHASE2_PLATFORM_HR_EMAIL, env.E2E_PHASE2_PASSWORD);
	await page.goto(`${IDP_ORIGIN}/admin/platform/users`);
	// Anchor the workspace positively first: a bare negative (count 0) would
	// also pass if HR were redirected away or the directory failed to load.
	await expect(page).toHaveURL(`${IDP_ORIGIN}/admin/platform/users`);
	await expect(
		page.getByRole("heading", { name: "Manage user accounts" }),
	).toBeVisible();
	const hrTarget = page
		.locator("tr")
		.filter({ hasText: env.E2E_PHASE2_BAN_TARGET_EMAIL })
		.first();
	await expect(hrTarget).toBeVisible();
	await expect(
		hrTarget.getByRole("button", { name: "Ban account" }),
	).toHaveCount(0);
	await expect(
		hrTarget.getByRole("button", { name: "Restore access" }),
	).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Ban account" })).toHaveCount(
		0,
	);
});

test("second organization renders bounded empty states", async ({ page }) => {
	await signInAsOrgAdmin(page);
	await page.goto(
		`${IDP_ORIGIN}/admin/organizations/${env.E2E_PHASE2_SECOND_ORG_ID}`,
	);
	await expect(page.getByText("No invitations found.")).toBeVisible();
	await expect(page.getByText("No members found.")).not.toBeVisible();
});

test("unmatched audit filters render the empty state", async ({ page }) => {
	const adminEmail = process.env.IDP_ADMIN_EMAIL;
	const adminPassword = process.env.IDP_ADMIN_PASSWORD;
	if (!adminEmail || !adminPassword) {
		throw new Error("IDP_ADMIN_EMAIL / IDP_ADMIN_PASSWORD are required");
	}
	await signIn(page, adminEmail, adminPassword);
	await page.goto(
		// Allowlisted event type the E2E seed/run never emits (retention purge
		// never executes here); invalid types are discarded by the server filter.
		`${IDP_ORIGIN}/admin/platform/audit?eventType=admin.audit.retention_purged`,
	);
	await expect(
		page.getByRole("heading", { name: "Audit trail" }),
	).toBeVisible();
	await expect(page.getByText("No events match this view.")).toBeVisible();
});

test("a different fixture user cannot accept another user's invitation", async ({
	page,
}) => {
	await signIn(page, env.E2E_PHASE2_ORG_MEMBER_EMAIL, env.E2E_PHASE2_PASSWORD);
	await page.goto(
		`${IDP_ORIGIN}/organizations/invitations/${env.E2E_PHASE2_INVITATION_ID}`,
	);
	await expect(
		page.getByText("Organization invitation", { exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "Accept invitation" }).click();

	await expect(page.getByText("Invitation access is denied")).toBeVisible();
	await expect(page.getByRole("status")).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Accept invitation" }),
	).toBeVisible();
});

test("invited user can accept the pending invitation", async ({ page }) => {
	// The seed provisions this account (email-verified); sign in, then accept.
	await signIn(page, env.E2E_PHASE2_INVITED_EMAIL, env.E2E_PHASE2_PASSWORD);

	await page.goto(
		`${IDP_ORIGIN}/organizations/invitations/${env.E2E_PHASE2_INVITATION_ID}`,
	);
	await expect(
		page.getByText("Organization invitation", { exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "Accept invitation" }).click();

	await expect(page.getByRole("status")).toContainText("Invitation accepted");
	await page.goto(`${IDP_ORIGIN}/organizations`);
	await expect(
		page.getByRole("heading", { name: "Choose an organization" }),
	).toBeVisible();
	const matrixCard = page
		.locator("[data-slot='card']")
		.filter({
			has: page.locator(`input[value="${env.E2E_PHASE2_ORG_ID}"]`),
		})
		.first();
	await expect(matrixCard).toBeVisible();
});

test("organization administration is usable on a phone-sized viewport", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await signInAsOrgAdmin(page);
	await openOrganizationAdministration(page);

	await expect(
		page.getByText("Organization administration", { exact: true }),
	).toBeVisible();
	await expect
		.poll(() =>
			page.evaluate<boolean>(
				"document.documentElement.scrollWidth <= window.innerWidth",
			),
		)
		.toBe(true);

	await page.keyboard.press("Tab");
	await expect
		.poll(() =>
			page.evaluate<boolean>(
				"document.activeElement?.tagName === 'A' || document.activeElement?.tagName === 'BUTTON'",
			),
		)
		.toBe(true);
});
