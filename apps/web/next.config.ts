import "@krazil-idp/env/web";
import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Security headers for every response. Auth pages must never be framed
 * (clickjacking on login/consent), and CSP keeps script execution local.
 * `unsafe-inline`/`unsafe-eval` concessions exist only where Next.js requires
 * them (styles always; scripts in dev).
 */
const securityHeaders = [
	{ key: "X-Frame-Options", value: "DENY" },
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
