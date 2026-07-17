import { branding } from "@krazil-idp/branding/config";
import { env } from "@krazil-idp/env/server";
import nodemailer, { type Transporter } from "nodemailer";

/**
 * Branded transactional email templates. All visual identity comes from
 * branding/config.ts — swapping the brand re-skins every email with zero
 * edits here.
 *
 * Delivery: a console mailer prints messages in development; production sends
 * over SMTP (nodemailer) configured entirely from MAILER_SMTP_* / MAILER_FROM
 * env vars, so any provider (SES SMTP, Mailgun, Postmark, Gmail, ...) works
 * with no code change.
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

/**
 * Production SMTP mailer (nodemailer). Configured from MAILER_SMTP_* env vars;
 * works with any SMTP provider. The transport is created once and reused.
 */
let transporter: Transporter | undefined;

function smtpTransport(): Transporter {
	if (transporter) return transporter;
	if (!env.MAILER_SMTP_HOST) {
		throw new Error(
			"MAILER_SMTP_HOST is required to send email; refusing to drop transactional email.",
		);
	}
	transporter = nodemailer.createTransport({
		host: env.MAILER_SMTP_HOST,
		port: env.MAILER_SMTP_PORT,
		// Implicit TLS on 465; require STARTTLS on 587/25 so an active MITM cannot
		// strip encryption and read token-bearing links — delivery fails instead.
		secure: env.MAILER_SMTP_PORT === 465,
		requireTLS: true,
		...(env.MAILER_SMTP_USER
			? { auth: { user: env.MAILER_SMTP_USER, pass: env.MAILER_SMTP_PASS } }
			: {}),
	});
	return transporter;
}

const smtpMailer: Mailer = {
	async send(message) {
		if (!env.MAILER_FROM) {
			throw new Error(
				"MAILER_FROM is required to send email; refusing to drop transactional email.",
			);
		}
		await smtpTransport().sendMail({
			from: env.MAILER_FROM,
			to: message.to,
			subject: message.subject,
			html: message.html,
			text: message.text,
		});
	},
};

export const mailer: Mailer =
	env.NODE_ENV === "production" ? smtpMailer : consoleMailer;

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
