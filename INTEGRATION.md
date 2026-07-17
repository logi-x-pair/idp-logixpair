# Relying-party integration

This IdP is an OIDC provider. Configure a relying party with the discovery URL only:

```text
https://auth.<brand-domain>.com/api/auth/.well-known/openid-configuration
```

Local development uses:

```text
http://localhost:3000/api/auth/.well-known/openid-configuration
```

Never copy authorization, token, JWKS, userinfo, or logout endpoint URLs into application code. Discovery is the source of truth.

## Client registration

Ask the IdP operator to add your exact callback and post-logout URLs to `branding/clients.ts`, run the seed command, and deliver the client ID/secret through a secret manager. Confidential web apps use `client_secret_basic`; SPAs/native apps use a public client with `token_endpoint_auth_method: "none"` and PKCE.

Required scopes:

- `openid`: OIDC identity and `sub`.
- `profile`: name/picture profile claims.
- `email`: email and `email_verified` claims.
- `offline_access`: refresh token; keep PKCE enabled.

## Web client example with openid-client

The following is the shape used by `apps/test-rp`. It discovers all endpoints from the issuer, uses authorization-code + PKCE + state + nonce, and lets the library validate the ID token signature, issuer, audience, nonce, and expiry using discovered JWKS.

```ts
import {
  allowInsecureRequests,
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  ClientSecretBasic,
  discovery,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
  fetchUserInfo,
  refreshTokenGrant,
} from "openid-client";

const config = await discovery(
  new URL(process.env.OIDC_ISSUER!),
  process.env.OIDC_CLIENT_ID!,
  { client_secret: process.env.OIDC_CLIENT_SECRET! },
  ClientSecretBasic(process.env.OIDC_CLIENT_SECRET!),
  { execute: [allowInsecureRequests] }, // local HTTP only; omit in production
);
const metadata = config.serverMetadata();
const issuer = metadata.issuer;
const jwksUrl = metadata.jwks_uri;
if (!issuer || !jwksUrl) throw new Error("Incomplete discovery metadata");

const verifier = randomPKCECodeVerifier();
const state = randomState();
const nonce = randomNonce();
const authorizationUrl = buildAuthorizationUrl(config, {
  redirect_uri: process.env.OIDC_REDIRECT_URI!,
  response_type: "code",
  scope: "openid profile email offline_access",
  state,
  nonce,
  code_challenge: await calculatePKCECodeChallenge(verifier),
  code_challenge_method: "S256",
  resource: issuer,
});

// Store verifier/state/nonce server-side, then redirect the browser.

const tokens = await authorizationCodeGrant(config, callbackUrl, {
  pkceCodeVerifier: verifier,
  expectedState: state,
  expectedNonce: nonce,
  idTokenExpected: true,
});
const claims = tokens.claims();
const userInfo = await fetchUserInfo(config, tokens.access_token!, claims!.sub!);
const refreshed = await refreshTokenGrant(config, tokens.refresh_token!);
```

Treat the authorization code, access token, refresh token, client secret, and PKCE verifier as secrets. Use secure, HTTP-only, same-site cookies for the RP session. Do not log callback URLs or token-bearing email links.

## User-opt-in two-factor authentication

Set `TWO_FACTOR_ENABLED=true` to expose TOTP enrollment, backup-code display, and account recovery controls. Enrollment is user-driven and requires the current password plus a first valid TOTP code. TOTP secrets and backup codes are encrypted at rest; backup codes are single-use. The server and client 2FA plugins remain mounted when the flag is false, so changing it back to false hides new enrollment but does not bypass an already-enrolled user's challenge. Disable 2FA from the authenticated account settings instead.

During an OIDC login, Better Auth signs the `oauth_query` on the initial sign-in request. If the user needs 2FA, the client navigates to `/two-factor` while retaining the current query string. The OAuth client plugin signs and forwards that query on the TOTP or backup-code POST, allowing the provider to restore OAuth state and return the normal authorization callback after verification. Never replace this with a client-supplied redirect or an unsigned query.

## Consent screen integrity

The consent screen renders the requesting application's identity (name, logo,
URI) from the same query parameters that the provider's signed `oauth_query`
covers (`ba_param` list + `sig`). Links missing that signature material are
rejected at display time, and tampered links fail signature verification when
the grant is submitted — so no grant can complete under mismatched branding.
This is display-integrity defense-in-depth; the authorization decision itself is
always bound to the signed query, never to the unsigned `client_id` URL
parameter alone.

## Resource-server verification

Prefer local JWT verification for normal traffic. The resource server still derives issuer, audience, and JWKS URL from discovery/configuration; it does not invent endpoint paths. With the provider resource client:

```ts
import { createAuthClient } from "better-auth/client";
import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";

const resourceClient = createAuthClient({
  plugins: [oauthProviderResourceClient()],
});
const metadata = config.serverMetadata();
const payload = await resourceClient.verifyAccessToken(accessToken, {
  verifyOptions: {
    issuer: metadata.issuer!,
    audience: metadata.issuer!, // or the explicit resource audience from discovery/config
  },
  jwksUrl: metadata.jwks_uri!,
  scopes: ["read:example"],
});
```

For `hybrid` mode, call the private `token-revocation-status` endpoint after
local verification on high-risk routes. For user tokens, send the verified
JWT's `sid`, `sub`, and `jti`; for machine-to-machine tokens, send its `azp`
and `jti`. The `jti` is required for token-specific denylist enforcement. The
IdP also requires a live session owned by that user or an enabled OAuth client,
respectively. In `immediate` mode, make this check on every protected resource
request. Fail closed if the status service is unavailable.

The authenticated `/oauth2/revoke` endpoint and
`bun --cwd apps/web run revoke-token <jwt_access_token>` verify the JWT
signature, issuer, audience, expiry, and `azp` ownership before storing its
signed `jti`. The denylist is checked by OAuth introspection and
`token-revocation-status`; raw JWKS verification cannot observe database
revocations. `revoke-user` remains the user-wide session, refresh-token, and
opaque-token kill switch but does not enumerate already-issued JWTs.

Do not use `/oauth2/introspect` as a substitute for local signature
verification. It is the right place to enforce a denylisted JWT because it now
returns `active: false` when the verified response includes a denylisted `jti`.
Use short lifetimes for sensitive scopes and follow `RUNBOOK.md` for
signing-key compromise.

## Logout

Clear the RP's own local session first, then use the discovered end-session endpoint with `id_token_hint` and an exact registered `post_logout_redirect_uri`. The IdP session ends, but standard RP-initiated logout does not delete another RP's local cookie. If an organization requires multi-RP logout, implement explicit front/back-channel coordination and test each RP's local session separately.

## Verification checklist

- Discovery URL loads and issuer matches the configured authority.
- Callback validates `state`, PKCE, nonce, ID-token signature, `iss`, `aud`, and `exp`.
- UserInfo is called with a valid access token and expected `sub`.
- Refresh replaces the refresh token; the old refresh token is rejected.
- Resource server checks issuer, audience, expiry, and required scopes.
- Redirect URI is an exact registered value.
- Production uses HTTPS and does not enable `allowInsecureRequests`.
