import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { createAuthClient } from "better-auth/client";
import {
	allowInsecureRequests,
	authorizationCodeGrant,
	buildAuthorizationUrl,
	buildEndSessionUrl,
	ClientSecretBasic,
	calculatePKCECodeChallenge,
	discovery,
	fetchUserInfo,
	randomNonce,
	randomPKCECodeVerifier,
	randomState,
	refreshTokenGrant,
} from "openid-client";

const port = Number(process.env.RP_PORT ?? "4101");

function requiredEnv(key: string): string {
	const value = process.env[key];
	if (!value) throw new Error(`${key} is required (see .env.example)`);
	return value;
}

const name = requiredEnv("RP_NAME");
const issuer = requiredEnv("OIDC_ISSUER");
const clientId = requiredEnv("RP_CLIENT_ID");
const clientSecret = requiredEnv("RP_CLIENT_SECRET");
const redirectUri = requiredEnv("RP_REDIRECT_URI");
const postLogoutRedirectUri = requiredEnv("RP_POST_LOGOUT_URI");
const peerLogoutUrl = process.env.RP_PEER_LOGOUT_URL;

const ACCESS_TOKEN_MODES = ["short-lived", "hybrid", "immediate"] as const;
type AccessTokenMode = (typeof ACCESS_TOKEN_MODES)[number];
const configuredAccessTokenMode =
	process.env.OAUTH_ACCESS_TOKEN_MODE ?? "short-lived";
if (
	!ACCESS_TOKEN_MODES.includes(configuredAccessTokenMode as AccessTokenMode)
) {
	throw new Error(
		`Unsupported OAUTH_ACCESS_TOKEN_MODE: ${configuredAccessTokenMode}`,
	);
}
const accessTokenMode = configuredAccessTokenMode as AccessTokenMode;
const revocationCheckSecret =
	accessTokenMode === "short-lived"
		? undefined
		: requiredEnv("OAUTH_REVOCATION_CHECK_SECRET");

function issuerEndpoint(path: string): string {
	const base = new URL(issuer);
	return new URL(
		`${base.pathname.replace(/\/$/, "")}/${path.replace(/^\/+/, "")}`,
		base.origin,
	).toString();
}
const revocationStatusUrl = issuerEndpoint("token-revocation-status");

// Cookies are host-scoped, not port-scoped. Namespace each RP instance so
// RP1 and RP2 never reuse each other's in-memory session IDs.
const sessionCookieName = `rp_${port}_${clientId.slice(0, 8)}`;

const oidcIssuer = new URL(issuer);
const config = await discovery(
	oidcIssuer,
	clientId,
	{ client_secret: clientSecret },
	ClientSecretBasic(clientSecret),
	{ execute: [allowInsecureRequests] },
);
const serverMetadata = config.serverMetadata();
const discoveredIssuer = serverMetadata.issuer;
const discoveredJwksUrl = serverMetadata.jwks_uri;
if (!discoveredIssuer || !discoveredJwksUrl) {
	throw new Error("OIDC discovery did not publish issuer and jwks_uri");
}
const verifiedIssuer: string = discoveredIssuer;
const verifiedJwksUrl: string = discoveredJwksUrl;
// Resource indicator/audience is the discovered issuer accepted by the
// provider's default valid-audience configuration; no endpoint is hardcoded.
const discoveredAudience = verifiedIssuer;
const resourceClient = createAuthClient({
	plugins: [oauthProviderResourceClient()],
});

type PendingLogin = {
	verifier: string;
	state: string;
	nonce: string;
};

type RPSession = {
	accessToken: string;
	refreshToken?: string;
	idToken: string;
	claims: Record<string, unknown>;
	userInfo: Record<string, unknown>;
	callbackState: string;
	callbackIssuer: string;
	callbackCodeReceived: boolean;
};

const pending = new Map<string, PendingLogin>();
const sessions = new Map<string, RPSession>();

function cookieValue(request: Request, key: string): string | undefined {
	const cookies = request.headers.get("cookie")?.split(";") ?? [];
	const pair = cookies
		.map((v) => v.trim())
		.find((v) => v.startsWith(`${key}=`));
	return pair?.slice(key.length + 1);
}

function newSessionId(): string {
	return crypto.randomUUID();
}

function escapeHtml(value: unknown): string {
	return String(value ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

async function assertAuthoritativeStatus(
	payload: Record<string, unknown>,
): Promise<void> {
	if (accessTokenMode === "short-lived") return;
	if (!revocationCheckSecret) throw new Error("Revocation secret is missing");
	const sid = typeof payload.sid === "string" ? payload.sid : undefined;
	const sub = typeof payload.sub === "string" ? payload.sub : undefined;
	const azp = typeof payload.azp === "string" ? payload.azp : undefined;
	const identity = sid && sub ? { sid, sub } : azp ? { azp } : undefined;
	if (!identity) throw new Error("Access token has no revocation identity");

	const response = await fetch(revocationStatusUrl, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${revocationCheckSecret}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(identity),
	});
	if (!response.ok) {
		throw new Error(`Revocation status returned HTTP ${response.status}`);
	}
	const body = (await response.json()) as { active?: unknown };
	if (body.active !== true)
		throw new Error("Access token is no longer authorized");
}

function page(title: string, body: string): Response {
	return new Response(
		`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:system-ui;max-width:720px;margin:4rem auto;padding:0 1rem;color:#172033}a,button{font:inherit}a{color:#4f46e5}.card{border:1px solid #dbe1ea;border-radius:12px;padding:1.5rem}.actions{display:flex;gap:1rem;margin-top:1rem}code{word-break:break-all}</style></head><body><div class="card"><h1>${escapeHtml(title)}</h1>${body}</div></body></html>`,
		{ headers: { "Content-Type": "text/html; charset=utf-8" } },
	);
}

function sessionCookie(id: string): string {
	return `${sessionCookieName}=${id}; Path=/; HttpOnly; SameSite=Lax`;
}

async function handleHome(request: Request): Promise<Response> {
	const id = cookieValue(request, sessionCookieName);
	const session = id ? sessions.get(id) : undefined;
	if (!session) {
		return page(
			name,
			`<p>OIDC issuer is loaded from discovery at <code>${escapeHtml(discoveredIssuer)}</code>.</p><p><a href="/login">Sign in with ${escapeHtml(discoveredIssuer)}</a></p>`,
		);
	}
	return page(
		name,
		`<p>Signed in. ID token claims were validated by openid-client using the discovery document and JWKS.</p><p data-testid="callback-proof">Callback verified: code=${session.callbackCodeReceived} state=${escapeHtml(session.callbackState)} iss=${escapeHtml(session.callbackIssuer)}</p><pre>${escapeHtml(JSON.stringify(session.claims, null, 2))}</pre><div class="actions"><a href="/userinfo">Userinfo</a><a href="/refresh">Refresh</a><a href="/me">Protected resource</a><a href="/logout">RP-initiated logout</a></div>`,
	);
}

async function handleLogin(): Promise<Response> {
	const verifier = randomPKCECodeVerifier();
	const challenge = await calculatePKCECodeChallenge(verifier);
	const state = randomState();
	const nonce = randomNonce();
	pending.set(state, { verifier, state, nonce });
	const url = buildAuthorizationUrl(config, {
		client_id: clientId,
		redirect_uri: redirectUri,
		response_type: "code",
		scope: "openid profile email offline_access",
		state,
		nonce,
		code_challenge: challenge,
		code_challenge_method: "S256",
		// Resource/audience is derived from discovered server metadata.
		resource: discoveredAudience,
	});
	return Response.redirect(url.toString());
}

async function handleCallback(request: Request): Promise<Response> {
	const currentUrl = new URL(request.url);
	const state = currentUrl.searchParams.get("state");
	const check = state ? pending.get(state) : undefined;
	if (!check) return page("Callback error", "Missing or unknown state.");

	const tokens = await authorizationCodeGrant(
		config,
		currentUrl,
		{
			pkceCodeVerifier: check.verifier,
			expectedState: check.state,
			expectedNonce: check.nonce,
			idTokenExpected: true,
		},
		{ resource: discoveredAudience },
	);
	pending.delete(state as string);
	const claims = tokens.claims();
	if (!claims?.sub || !tokens.id_token || !tokens.access_token) {
		return page(
			"Callback error",
			"The provider did not return the required OIDC tokens.",
		);
	}
	const userInfo = await fetchUserInfo(config, tokens.access_token, claims.sub);
	const sessionId = cookieValue(request, sessionCookieName) ?? newSessionId();
	sessions.set(sessionId, {
		accessToken: tokens.access_token,
		refreshToken: tokens.refresh_token,
		idToken: tokens.id_token,
		claims: claims as Record<string, unknown>,
		userInfo: userInfo as Record<string, unknown>,
		callbackState: state as string,
		callbackIssuer: currentUrl.searchParams.get("iss") ?? "",
		callbackCodeReceived: currentUrl.searchParams.has("code"),
	});
	return new Response(null, {
		status: 302,
		headers: { Location: "/", "Set-Cookie": sessionCookie(sessionId) },
	});
}

async function handleUserinfo(request: Request): Promise<Response> {
	const id = cookieValue(request, sessionCookieName);
	const session = id ? sessions.get(id) : undefined;
	if (!session)
		return Response.redirect(new URL("/login", request.url).toString());
	return page(
		"Userinfo",
		`<pre>${escapeHtml(JSON.stringify(session.userInfo, null, 2))}</pre><p><a href="/">Back</a></p>`,
	);
}

async function handleRefresh(request: Request): Promise<Response> {
	const id = cookieValue(request, sessionCookieName);
	const session = id ? sessions.get(id) : undefined;
	if (!session?.refreshToken)
		return page("Refresh unavailable", "No refresh token is stored.");
	const tokens = await refreshTokenGrant(config, session.refreshToken, {
		resource: discoveredAudience,
	});
	const claims = tokens.claims() ?? session.claims;
	sessions.set(id as string, {
		...session,
		accessToken: tokens.access_token ?? session.accessToken,
		refreshToken: tokens.refresh_token ?? session.refreshToken,
		idToken: tokens.id_token ?? session.idToken,
		claims: claims as Record<string, unknown>,
	});
	return new Response(null, { status: 302, headers: { Location: "/" } });
}

async function handleProtectedResource(request: Request): Promise<Response> {
	const id = cookieValue(request, sessionCookieName);
	const session = id ? sessions.get(id) : undefined;
	if (!session)
		return Response.redirect(new URL("/login", request.url).toString());
	try {
		const verifyAccessToken = resourceClient.verifyAccessToken as unknown as (
			token: string,
			opts: {
				verifyOptions: { issuer: string; audience: string };
				jwksUrl: string;
			},
		) => Promise<Record<string, unknown>>;
		const payload = await verifyAccessToken(session.accessToken, {
			verifyOptions: { issuer: verifiedIssuer, audience: discoveredAudience },
			jwksUrl: verifiedJwksUrl,
		});
		await assertAuthoritativeStatus(payload);
		const verificationMessage =
			accessTokenMode === "short-lived"
				? "verifyAccessToken accepted the JWT locally."
				: `verifyAccessToken accepted the JWT plus ${accessTokenMode} revocation status.`;
		return page(
			"Protected resource",
			`<p>${verificationMessage}</p><pre>${escapeHtml(JSON.stringify(payload, null, 2))}</pre><p><a href="/">Back</a></p>`,
		);
	} catch (error) {
		return page(
			"Protected resource rejected",
			`<p>${escapeHtml(error instanceof Error ? error.message : error)}</p><p><a href="/login">Sign in again</a></p>`,
		);
	}
}

async function handleLogout(request: Request): Promise<Response> {
	const id = cookieValue(request, sessionCookieName);
	const session = id ? sessions.get(id) : undefined;
	if (!session) return Response.redirect(new URL("/", request.url).toString());
	if (id) sessions.delete(id);
	// Optional peer callback lets the E2E harness clear the second RP's local
	// session explicitly. OIDC end-session itself only clears the IdP session;
	// it cannot remotely delete another RP's local cookie.
	if (peerLogoutUrl) await fetch(peerLogoutUrl).catch(() => undefined);
	const url = buildEndSessionUrl(config, {
		id_token_hint: session.idToken,
		post_logout_redirect_uri: postLogoutRedirectUri,
	});
	return new Response(null, {
		status: 302,
		headers: {
			Location: url.toString(),
			"Set-Cookie": `${sessionCookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
		},
	});
}

async function handleIdpLogoutOnly(request: Request): Promise<Response> {
	const id = cookieValue(request, sessionCookieName);
	const session = id ? sessions.get(id) : undefined;
	if (!session) return Response.redirect(new URL("/", request.url).toString());
	const url = buildEndSessionUrl(config, {
		id_token_hint: session.idToken,
		post_logout_redirect_uri: postLogoutRedirectUri,
	});
	// Deliberately preserve the RP cookie so the next /me request tests the
	// resource server's token authorization policy after IdP termination.
	return Response.redirect(url.toString());
}

async function handler(request: Request): Promise<Response> {
	const { pathname } = new URL(request.url);
	try {
		if (pathname === "/") return handleHome(request);
		if (pathname === "/login") return handleLogin();
		if (pathname === "/callback") return handleCallback(request);
		if (pathname === "/userinfo") return handleUserinfo(request);
		if (pathname === "/refresh") return handleRefresh(request);
		if (pathname === "/me") return handleProtectedResource(request);
		if (pathname === "/logout-idp-only") return handleIdpLogoutOnly(request);
		if (pathname === "/logout") return handleLogout(request);
		if (pathname === "/logout-local") {
			sessions.clear();
			return new Response(null, { status: 204 });
		}
		if (pathname === "/icon.svg")
			return new Response(
				'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="#4f46e5"/></svg>',
				{ headers: { "Content-Type": "image/svg+xml" } },
			);
		return new Response("Not found", { status: 404 });
	} catch (error) {
		console.error(`${name} RP request failed`, error);
		return page(
			"RP error",
			escapeHtml(error instanceof Error ? error.message : error),
		);
	}
}

Bun.serve({ port, fetch: handler });
console.log(
	`${name} listening on http://localhost:${port}; discovery issuer ${discoveredIssuer}`,
);
