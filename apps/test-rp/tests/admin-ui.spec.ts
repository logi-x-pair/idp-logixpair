import { expect, type Page, test } from "@playwright/test";

const adminEmail = process.env.IDP_ADMIN_EMAIL;
const adminPassword = process.env.IDP_ADMIN_PASSWORD;
const userEmail = process.env.TEST_RP_USER_EMAIL;
const userPassword = process.env.TEST_RP_USER_PASSWORD;

if (!adminEmail || !adminPassword || !userEmail || !userPassword) {
	throw new Error("The localhost UI harness credentials are required");
}

async function signIn(page: Page, email: string, password: string) {
	await page.getByLabel("Email").fill(email);
	await page.getByLabel("Password").fill(password);
	await page.getByRole("button", { name: "Sign in" }).click();
}

/**
 * Mirrors `buildSignedOAuthQuery` from @better-auth/oauth-provider@1.6.23
 * (dist signed-query): the client forwards ONLY `sig`, the `ba_param` name
 * list, and every parameter named by `ba_param`, in original URL order.
 * Reimplemented here so the round-trip assertion stays byte-for-byte against
 * the pinned plugin semantics.
 */
function expectedSignedQuery(search: string): string | undefined {
	const params = new URLSearchParams(search);
	if (!params.has("sig")) return undefined;
	const signedNames = params.getAll("ba_param");
	if (signedNames.length === 0) return undefined;
	const signed = new Set(signedNames);
	const out = new URLSearchParams();
	for (const [key, value] of params.entries()) {
		if (key === "sig" || key === "ba_param" || signed.has(key)) {
			out.append(key, value);
		}
	}
	return out.toString();
}

test("platform admin reaches the bounded organization workspace", async ({
	page,
}) => {
	const organizationName = `Phase 2 UI ${Date.now()}`;
	const organizationSlug = `phase-2-ui-${Date.now()}`;
	const invitationEmail = `phase-2-invite-${Date.now()}@localhost.test`;
	await page.goto("http://localhost:3000/admin/platform");
	await expect(page).toHaveURL(/localhost:3000\/sign-in/);
	expect(new URL(page.url()).searchParams.get("returnTo")).toBe(
		"/admin/platform",
	);

	await page.goto(
		"http://localhost:3000/sign-in?returnTo=https%3A%2F%2Fevil.example",
	);
	await page.getByLabel("Email").fill(adminEmail);
	await page.getByLabel("Password").fill(adminPassword);
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page).toHaveURL("http://localhost:3000/admin/platform");
	await expect(
		page.getByRole("heading", { name: "Platform administration" }),
	).toBeVisible();
	await page.getByRole("link", { name: "Open workspace" }).first().click();
	await expect(page).toHaveURL(
		/localhost:3000\/admin\/platform\/organizations/,
	);

	const initialAdmin = page
		.locator("#organization-initial-admin option")
		.filter({ hasText: userEmail })
		.first();
	const initialAdminId = await initialAdmin.getAttribute("value");
	if (!initialAdminId)
		throw new Error("The seeded OAuth organization user was not listed");
	await page.getByLabel("Organization name").fill(organizationName);
	await page.getByLabel("Slug").fill(organizationSlug);
	await page
		.locator("#organization-initial-admin")
		.selectOption(initialAdminId);
	await page.getByRole("button", { name: "Create organization" }).click();
	await expect(page.getByRole("status")).toContainText("Organization created");
	await expect(page.getByText(organizationSlug)).toBeVisible();
	await page
		.locator("[data-slot='card']")
		.filter({ hasText: organizationSlug })
		.getByRole("link", { name: "Open administration" })
		.click();
	await expect(page).toHaveURL(/localhost:3000\/admin\/organizations\//);
	await expect(
		page.getByRole("heading", { name: organizationName }),
	).toBeVisible();
	await expect(page.getByText("Binding status", { exact: true })).toBeVisible();
	await expect(
		page.getByText("No binding is registered for this organization."),
	).toBeVisible();

	await page.setViewportSize({ width: 390, height: 844 });
	await page.reload();
	await expect(
		page.getByRole("heading", { name: organizationName }),
	).toBeVisible();
	const menuButton = page.getByRole("button", { name: "Open user menu" });
	await menuButton.focus();
	await expect(menuButton).toBeFocused();

	await page.getByLabel("Email").fill(invitationEmail);
	await page.locator("#invite-role").selectOption("user");

	await page.getByRole("button", { name: "Create invitation" }).click();
	await expect(page.getByRole("status")).toContainText("Invitation created");
	await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
});
test("OAuth post-login organization selection preserves signed state", async ({
	page,
}) => {
	await page.goto("http://localhost:4101/");
	await page.getByRole("link", { name: /Sign in with/ }).click();
	await expect(page).toHaveURL(/localhost:3000\/sign-in/);
	const signInUrl = new URL(page.url());
	expect(signInUrl.searchParams.get("sig")).toBeTruthy();
	expect(signInUrl.searchParams.get("ba_param")).toBeTruthy();
	await page.getByLabel("Email").fill(userEmail);
	await page.getByLabel("Password").fill(userPassword);
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page).toHaveURL(/localhost:3000\/organizations/);
	const selectionSearch = new URL(page.url()).search;
	const callbackRequests: string[] = [];
	page.on("request", (request) => {
		const url = new URL(request.url());
		if (
			request.isNavigationRequest() &&
			request.method() === "GET" &&
			url.origin === "http://localhost:4101" &&
			url.pathname === "/callback"
		) {
			callbackRequests.push(url.href);
		}
	});
	const continueRequestPromise = page.waitForRequest(
		(request) =>
			request.method() === "POST" &&
			request.url().includes("/api/auth/oauth2/continue"),
	);
	await page.getByRole("button", { name: "Set active" }).first().click();
	const continueRequest = await continueRequestPromise;
	const body = JSON.parse(continueRequest.postData() ?? "{}") as {
		postLogin?: boolean;
		oauth_query?: string;
	};
	expect(body.postLogin).toBe(true);
	expect(typeof body.oauth_query).toBe("string");
	// Byte-for-byte round trip: the continue POST carries exactly the signed
	// subset of the selection page's signed query.
	const expected = expectedSignedQuery(selectionSearch);
	expect(expected).toBeTruthy();
	expect(body.oauth_query).toBe(expected);
	await expect(page).toHaveURL("http://localhost:4101/", { timeout: 15_000 });
	expect(callbackRequests).toHaveLength(1);
	await expect(page.getByTestId("callback-proof")).toContainText("code=true");
});

test("ordinary users cannot open platform administration", async ({ page }) => {
	for (const path of [
		"/dashboard",
		"/account",
		"/organizations",
		"/organizations/unknown-organization-id",
		"/organizations/invitations/unknown-invitation-id",
		"/admin/platform",
		"/admin/platform/organizations",
		"/admin/platform/users",
		"/admin/platform/audit",
		"/admin/organizations/unknown-organization-id",
	]) {
		await page.goto(`http://localhost:3000${path}`);
		await expect(page).toHaveURL(/localhost:3000\/sign-in/);
	}
	// The final redirect lands on the sign-in form; protected content never
	// renders for unauthenticated requests.
	await expect(page.getByLabel("Email")).toBeVisible();
	await signIn(page, userEmail, userPassword);
	await expect(page).toHaveURL("http://localhost:3000/dashboard");
	await page.goto("http://localhost:3000/admin/platform");
	await expect(page).toHaveURL("http://localhost:3000/dashboard");
	await expect(
		page.getByRole("heading", { name: "Platform administration" }),
	).not.toBeVisible();
});

test("platform moderator and HR users receive bounded account navigation", async ({
	page,
}) => {
	const suffix = Date.now();
	const moderatorEmail = `phase2-moderator-${suffix}@example.com`;
	const hrEmail = `phase2-hr-${suffix}@example.com`;
	const password = `phase2-role-password-${suffix}`;

	await page.goto("http://localhost:3000/sign-in");
	await signIn(page, adminEmail, adminPassword);
	await expect(page).toHaveURL("http://localhost:3000/admin/platform");
	await page.goto("http://localhost:3000/admin/platform/users");
	await page
		.getByLabel("Name", { exact: true })
		.first()
		.fill("Phase 2 Moderator");
	await page.getByLabel("Email", { exact: true }).first().fill(moderatorEmail);
	await page.getByLabel("Temporary password").fill(password);
	await page.locator("#new-account-role").selectOption("moderator");
	await page.getByRole("button", { name: "Create account" }).click();
	await expect(page.getByRole("status")).toContainText("Account created");

	await page
		.getByLabel("Name", { exact: true })
		.first()
		.fill("Phase 2 HR User");
	await page.getByLabel("Email", { exact: true }).first().fill(hrEmail);
	await page.getByLabel("Temporary password").fill(password);
	await page.locator("#new-account-role").selectOption("hr_user");
	await page.getByRole("button", { name: "Create account" }).click();
	await expect(page.getByRole("status")).toContainText("Account created");

	await page.getByRole("button", { name: "Open user menu" }).click();
	await page.getByRole("menuitem", { name: "Sign out" }).click();
	await expect(page).toHaveURL(/localhost:3000\/sign-in/);
	await signIn(page, moderatorEmail, password);
	await expect(page).toHaveURL("http://localhost:3000/dashboard");
	await expect(
		page.getByRole("link", { name: "Manage user accounts" }),
	).toBeVisible();
	await expect(
		page.getByRole("link", { name: "Platform administration" }),
	).not.toBeVisible();
	await page.goto("http://localhost:3000/admin/platform");
	await expect(page).toHaveURL("http://localhost:3000/dashboard");

	await page.getByRole("button", { name: "Open user menu" }).click();
	await page.getByRole("menuitem", { name: "Sign out" }).click();
	await expect(page).toHaveURL(/localhost:3000\/sign-in/);
	await signIn(page, hrEmail, password);
	await expect(page).toHaveURL("http://localhost:3000/dashboard");
	await expect(
		page.getByRole("link", { name: "Manage user accounts" }),
	).toBeVisible();
	await expect(
		page.getByRole("link", { name: "Platform administration" }),
	).not.toBeVisible();
});

test("banned sessions fail closed at the page boundary", async ({
	page,
	browser,
}) => {
	const suffix = Date.now();
	const victimEmail = `phase2-boundary-${suffix}@example.com`;
	const victimPassword = `phase2-boundary-password-${suffix}`;

	// A platform admin creates a disposable ordinary account through the UI.
	const adminContext = await browser.newContext();
	const adminPage = await adminContext.newPage();
	try {
		await adminPage.goto("http://localhost:3000/sign-in");
		await signIn(adminPage, adminEmail, adminPassword);
		await expect(adminPage).toHaveURL("http://localhost:3000/admin/platform");
		await adminPage.goto("http://localhost:3000/admin/platform/users");
		await adminPage
			.getByLabel("Name", { exact: true })
			.first()
			.fill("Phase 2 Boundary");
		await adminPage
			.getByLabel("Email", { exact: true })
			.first()
			.fill(victimEmail);
		await adminPage.getByLabel("Temporary password").fill(victimPassword);
		await adminPage.locator("#new-account-role").selectOption("user");
		await adminPage.getByRole("button", { name: "Create account" }).click();
		await expect(adminPage.getByRole("status")).toContainText(
			"Account created",
		);

		// The victim signs in and reaches the protected dashboard.
		await page.goto("http://localhost:3000/sign-in");
		await signIn(page, victimEmail, victimPassword);
		await expect(page).toHaveURL("http://localhost:3000/dashboard");

		// The admin bans the disposable account through the users workspace.
		await adminPage.fill("#platform-user-search", victimEmail);
		await adminPage.getByRole("button", { name: "Search" }).click();
		await adminPage.getByRole("button", { name: "Ban account" }).click();
		await adminPage
			.getByRole("dialog")
			.getByRole("button", { name: "Ban account" })
			.click();
		await expect(adminPage.getByRole("status")).toContainText(
			"Account access updated",
		);
		await expect(adminPage.getByText("Banned", { exact: true })).toBeVisible();

		// The victim's stale cookie now fails closed at the page boundary.
		await page.goto("http://localhost:3000/dashboard");
		await expect(page).toHaveURL(/localhost:3000\/sign-in/);
		await expect(page.getByLabel("Email")).toBeVisible();
	} finally {
		// The disposable account stays banned; it is unique to this run and
		// the E2E database is recreated on every bootstrap, so no shared
		// fixture can leak into later suites.
		await adminContext.close().catch(() => undefined);
	}
});
