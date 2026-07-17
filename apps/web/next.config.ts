import "@krazil-idp/env/web";
import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Static security headers for every response. Auth pages must never be framed
 * (clickjacking on login/consent). The Content-Security-Policy is emitted here
 * ONLY in development (relaxed, for Turbopack HMR); production CSP is
 * nonce-based and set per-request in src/proxy.ts.
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
	// Development-only relaxed CSP: HMR needs 'unsafe-inline'/'unsafe-eval' and
	// localhost HTTP RP icons. Production CSP lives in src/proxy.ts (nonce).
	...(isProduction
		? []
		: [
				{
					key: "Content-Security-Policy",
					value: [
						"default-src 'self'",
						"script-src 'self' 'unsafe-inline' 'unsafe-eval'",
						"style-src 'self' 'unsafe-inline'",
						"img-src 'self' data: https: http:",
						"frame-ancestors 'none'",
						"base-uri 'self'",
						"form-action 'self'",
					].join("; "),
				},
			]),
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
	poweredByHeader: false,
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
