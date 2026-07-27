import { describe, expect, test } from "bun:test";
import type { MailMessage } from "@krazil-idp/auth/email";

process.env.DATABASE_URL ??=
	"postgres://postgres:test@localhost:5432/krazil_idp_test";
process.env.BETTER_AUTH_SECRET ??= "test-only-better-auth-secret-0123456789";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.CORS_ORIGIN ??= "http://localhost:3000";
process.env.NODE_ENV ??= "test";

const { consoleMailer } = await import("@krazil-idp/auth/email");

const SENTINEL_URL =
	"https://localhost:3000/api/auth/verify-email?token=sentinel-password";

describe("console mailer safety", () => {
	test("redacts token-bearing action URLs from stdout", async () => {
		const lines: string[] = [];
		const originalLog = console.log;
		console.log = (...args: unknown[]) =>
			lines.push(args.map(String).join(" "));
		try {
			const message: MailMessage = {
				to: "user@example.test",
				subject: "Verify email",
				text: `Open ${SENTINEL_URL} to verify your address.`,
				html: `<a href="${SENTINEL_URL}">Verify</a>`,
			};
			await consoleMailer.send(message);
		} finally {
			console.log = originalLog;
		}

		const output = lines.join("\n");
		expect(output).toContain("[redacted action URL]");
		expect(output).not.toContain(SENTINEL_URL);
		expect(output).not.toContain("sentinel-password");
	});
});
