import { type NextRequest, NextResponse } from "next/server";

/**
 * Production CSP uses a per-request nonce + strict-dynamic so framework inline
 * scripts run without 'unsafe-inline'. Next.js reads the CSP request header
 * during SSR and stamps the nonce onto its own inline scripts. Development
 * keeps the relaxed CSP from next.config.ts (HMR needs 'unsafe-eval').
 */
export default function proxy(request: NextRequest) {
	if (process.env.NODE_ENV !== "production") return NextResponse.next();
	const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
	const csp = [
		"default-src 'self'",
		`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: https:",
		"frame-ancestors 'none'",
		"base-uri 'self'",
		"form-action 'self'",
	].join("; ");
	const requestHeaders = new Headers(request.headers);
	requestHeaders.set("x-nonce", nonce);
	requestHeaders.set("Content-Security-Policy", csp);
	const response = NextResponse.next({ request: { headers: requestHeaders } });
	response.headers.set("Content-Security-Policy", csp);
	return response;
}

export const config = {
	matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico).*)" }],
};
