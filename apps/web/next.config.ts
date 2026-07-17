import "@krazil-idp/env/web";
import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Security headers for every response. Auth pages must never be framed
 * (clickjacking on login/consent), and CSP keeps script execution local.
 * Next.js requires `unsafe-inline` for its generated styles and runtime
 * scripts; `unsafe-eval` is allowed only in development for the dev server.
 */
const securityHeaders = [
	{ key: "X-Frame-Options", value: "DENY" },
	{ key: "Cross-Origin-Opener-Policy", value: "same-origin" },
	{ key: "X-Content-Type-Options", value: "nosniff" },
	{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
	{
		key: "Permissions-Policy",
		value: "camera=(), microphone=(), geolocation=()",
	},
	{
		key: "Content-Security-Policy",
		value: [
			"default-src 'self'",
			`script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
			"style-src 'self' 'unsafe-inline'",
			// Production: HTTPS only. Dev additionally allows localhost HTTP RP icons.
			`img-src 'self' data: https:${isProduction ? "" : " http:"}`,
			"frame-ancestors 'none'",
			"base-uri 'self'",
			"form-action 'self'",
		].join("; "),
	},
	...(isProduction
		? [
				{
					key: "Strict-Transport-Security",
					value: "max-age=63072000; includeSubDomains",
				},
			]
		: []),
];

const nextConfig: NextConfig = {
	typedRoutes: true,
	reactCompiler: true,
	async headers() {
		return [
			{
				source: "/(.*)",
				headers: securityHeaders,
			},
		];
	},
};

export default nextConfig;
