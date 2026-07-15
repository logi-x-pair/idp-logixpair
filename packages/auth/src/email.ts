import { branding } from "@krazil-idp/branding/config";
import { env } from "@krazil-idp/env/server";

/**
 * Branded transactional email templates. All visual identity comes from
 * branding/config.ts — swapping the brand re-skins every email with zero
 * edits here.
 *
 * Delivery is pluggable: the template ships with a console mailer for local
 * development. Production deployments implement `Mailer` against their
 * provider (SES, Resend, Postmark, ...) and swap it in `packages/auth`.
 */

export interface MailMessage {
	to: string;
	subject: string;
	html: string;
	text: string;
}

export interface Mailer {
	send(message: MailMessage): Promise<void>;
}

/**
 * Dev/test mailer: prints the message (including the token-bearing action
 * URL) instead of delivering it. NEVER used in production — token URLs in
 * logs are usable credentials.
 */
export const consoleMailer: Mailer = {
	send(message) {
		console.log(
			`[mail] to=${message.to} subject=${JSON.stringify(message.subject)}\n${message.text}`,
		);
		return Promise.resolve();
	},
};

/** Production guard: refuses delivery until a real provider is wired in. */
const failClosedMailer: Mailer = {
	send() {
		return Promise.reject(
			new Error(
				"No mailer configured for production. Implement Mailer against your email provider in packages/auth/src/email.ts (see NEW_BRAND.md).",
			),
		);
	},
};

export const mailer: Mailer =
	env.NODE_ENV === "production" ? failClosedMailer : consoleMailer;

function brandedEmail(
	heading: string,
	bodyHtml: string,
	actionUrl: string,
	actionLabel: string,
) {
	const html = `<!doctype html>
<html>
  <body style="margin:0;padding:32px 16px;background:${branding.backgroundColor};font-family:${branding.fontFamily};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:32px;">
          <tr><td style="font-size:20px;font-weight:700;color:#111;padding-bottom:8px;">${branding.brandName}</td></tr>
          <tr><td style="font-size:16px;font-weight:600;color:#111;padding-bottom:12px;">${heading}</td></tr>
          <tr><td style="font-size:14px;color:#444;line-height:1.6;padding-bottom:24px;">${bodyHtml}</td></tr>
          <tr><td>
            <a href="${actionUrl}" style="display:inline-block;background:${branding.primaryColor};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:8px;">${actionLabel}</a>
          </td></tr>
          <tr><td style="font-size:12px;color:#888;padding-top:24px;">
            If you didn't request this, you can safely ignore this email.
            Need help? <a href="${branding.supportUrl}" style="color:${branding.primaryColor};">Contact support</a>.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
	return html;
}

export function verificationEmail(to: string, url: string): MailMessage {
	return {
		to,
		subject: `Verify your ${branding.brandName} email address`,
		html: brandedEmail(
			"Verify your email address",
			`Confirm this email address to finish setting up your ${branding.brandName} account.`,
			url,
			"Verify email",
		),
		text: `Verify your ${branding.brandName} email address: ${url}`,
	};
}

export function resetPasswordEmail(to: string, url: string): MailMessage {
	return {
		to,
		subject: `Reset your ${branding.brandName} password`,
		html: brandedEmail(
			"Reset your password",
			`We received a request to reset the password for your ${branding.brandName} account. This link expires shortly.`,
			url,
			"Reset password",
		),
		text: `Reset your ${branding.brandName} password: ${url}`,
	};
}
