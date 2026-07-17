import { expect, test } from "@playwright/test";
import { generateTotpCode } from "../totp";

const email = process.env.TEST_RP_USER_EMAIL;
const password = process.env.TEST_RP_USER_PASSWORD;
const accessTokenMode = process.env.OAUTH_ACCESS_TOKEN_MODE ?? "short-lived";
const accessTokenCheckMessage =
	accessTokenMode === "short-lived"
		? "verifyAccessToken accepted the JWT locally."
		: `verifyAccessToken accepted the JWT plus ${accessTokenMode} revocation status.`;
if (!email || !password) {
	throw new Error(
		"TEST_RP_USER_EMAIL and TEST_RP_USER_PASSWORD are required in apps/test-rp/.env",
	);
}

test("RP1 login -> tokens -> RP2 silent SSO -> refresh -> coordinated logout", async ({
	page,
}) => {
	await page.goto("http://localhost:4101/");
	await page.getByRole("link", { name: /Sign in with/ }).click();
	await expect(page).toHaveURL(/localhost:3000\/sign-in/);
	await page.getByLabel("Email").fill(email);
	await page.getByLabel("Password").fill(password);
	await page.getByRole("button", { name: "Sign in" }).click();

	await expect(page).toHaveURL("http://localhost:4101/");
	await expect(page.getByText("Signed in.", { exact: false })).toBeVisible();
	const callbackProof = page.getByTestId("callback-proof");
	await expect(callbackProof).toContainText("code=true");
	await expect(callbackProof).toContainText("state=");
	await expect(callbackProof).toContainText(
		"iss=http://localhost:3000/api/auth",
	);

	await page.getByRole("link", { name: "Protected resource" }).click();
	await expect(page.getByText(accessTokenCheckMessage)).toBeVisible();
	await page.goto("http://localhost:4101/refresh");
	await expect(page).toHaveURL("http://localhost:4101/");
	await expect(page.getByText("Signed in.", { exact: false })).toBeVisible();

	let sawLoginFormOnRp2 = false;
	page.on("framenavigated", (frame) => {
		if (
			frame === page.mainFrame() &&
			frame.url().includes("localhost:3000/sign-in")
		) {
			sawLoginFormOnRp2 = true;
		}
	});
	await page.goto("http://localhost:4102/");
	await page.getByRole("link", { name: /Sign in with/ }).click();
	await expect(page).toHaveURL("http://localhost:4102/");
	await expect(page.getByText("Signed in.", { exact: false })).toBeVisible();
	expect(sawLoginFormOnRp2).toBe(false);

	// RP1 end-session clears the IdP session. RP_PEER_LOGOUT_URL is an explicit
	// harness callback that clears RP2's local session too; standard OIDC
	// end-session cannot delete another RP's local cookie by itself.
	await page.goto("http://localhost:4101/logout");
	await expect(page).toHaveURL("http://localhost:4101/");
	await expect(page.getByRole("link", { name: /Sign in with/ })).toBeVisible();
	await page.goto("http://localhost:4102/");
	await expect(page.getByRole("link", { name: /Sign in with/ })).toBeVisible();

	// IdP session itself is gone: another authorize attempt must ask for creds.
	await page.goto("http://localhost:4102/login");
	await expect(page).toHaveURL(/localhost:3000\/sign-in/);
	await expect(page.getByLabel("Password")).toBeVisible();
});

test("resource authorization follows mode after IdP session termination", async ({
	page,
}) => {
	await page.goto("http://localhost:4101/");
	await page.getByRole("link", { name: /Sign in with/ }).click();
	await page.getByLabel("Email").fill(email as string);
	await page.getByLabel("Password").fill(password as string);
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page).toHaveURL("http://localhost:4101/");

	await page.goto("http://localhost:4101/me");
	await expect(page.getByText(accessTokenCheckMessage)).toBeVisible();
	await page.goto("http://localhost:4101/logout-idp-only");
	await expect(page).toHaveURL("http://localhost:4101/");
	await expect(page.getByText("Signed in.", { exact: false })).toBeVisible();

	await page.goto("http://localhost:4101/me");
	if (accessTokenMode === "short-lived") {
		await expect(page.getByText(accessTokenCheckMessage)).toBeVisible();
		return;
	}
	await expect(
		page.getByRole("heading", { name: "Protected resource rejected" }),
	).toBeVisible();
});

test("2FA preserves signed OAuth state through verification", async ({
	page,
}) => {
	test.skip(
		process.env.TWO_FACTOR_ENABLED !== "true",
		"requires the dedicated enabled-mode 2FA fixture",
	);
	const twoFactorEmail = process.env.E2E_2FA_USER_EMAIL;
	const twoFactorPassword = process.env.E2E_2FA_USER_PASSWORD;
	const twoFactorSecret = process.env.E2E_2FA_TOTP_SECRET;
	if (!twoFactorEmail || !twoFactorPassword || !twoFactorSecret) {
		throw new Error("Enabled-mode 2FA fixture state is missing");
	}

	await page.goto("http://localhost:4101/");
	await page.getByRole("link", { name: /Sign in with/ }).click();
	await expect(page).toHaveURL(/localhost:3000\/sign-in/);
	const initialSignInUrl = new URL(page.url());
	expect(
		initialSignInUrl.searchParams.get("oauth_query") ??
			initialSignInUrl.searchParams.get("sig"),
	).toBeTruthy();

	await page.getByLabel("Email").fill(twoFactorEmail);
	await page.getByLabel("Password").fill(twoFactorPassword);
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page).toHaveURL(/localhost:3000\/two-factor/);
	const challengeUrl = new URL(page.url());
	expect(challengeUrl.search).toBe(initialSignInUrl.search);

	const code = await generateTotpCode(twoFactorSecret);
	const codeInput = page.getByLabel("Authenticator code");
	const verifyButton = page.getByRole("button", { name: "Verify" });
	await expect
		.poll(async () => {
			await codeInput.fill("");
			await codeInput.pressSequentially(code);
			return verifyButton.isEnabled();
		})
		.toBe(true);
	await expect(verifyButton).toBeEnabled();
	const [verifyRequest] = await Promise.all([
		page.waitForRequest(
			(request) =>
				request.method() === "POST" &&
				request.url().includes("/api/auth/two-factor/verify-totp"),
		),
		verifyButton.click(),
	]);
	const verifyBody = JSON.parse(verifyRequest.postData() ?? "{}") as {
		oauth_query?: string;
	};
	expect(typeof verifyBody.oauth_query).toBe("string");

	await expect(page).toHaveURL("http://localhost:4101/");
	await expect(page.getByTestId("callback-proof")).toContainText("code=true");
	await page.goto("http://localhost:3000/account");
	await expect(
		page.getByRole("heading", { name: "Two-step verification" }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Disable two-step verification" }),
	).toBeVisible();

	let sawLoginFormOnRp2 = false;
	page.on("framenavigated", (frame) => {
		if (
			frame === page.mainFrame() &&
			frame.url().includes("localhost:3000/sign-in")
		) {
			sawLoginFormOnRp2 = true;
		}
	});
	await page.goto("http://localhost:4102/");
	await page.getByRole("link", { name: /Sign in with/ }).click();
	await expect(page).toHaveURL("http://localhost:4102/");
	await expect(page.getByTestId("callback-proof")).toContainText("code=true");
	expect(sawLoginFormOnRp2).toBe(false);
});
