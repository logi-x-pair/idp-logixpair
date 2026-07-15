# PROMPT: Build an OIDC-Compliant SSO Identity Provider with Better Auth (OAuth 2.1 Provider Plugin)

You are a senior auth/identity engineer. Build a production-grade, OIDC-compliant Identity Provider (IdP) as a **white-label template repository**. The deployment model: for each new brand/customer, we clone this repo, edit ONE branding folder, and deploy a fully-branded standalone SSO server for that brand's apps. Like Google's login page, the branding is fixed per deployment — it does NOT change at runtime based on which client app initiated the flow.

Use the **Better Auth** framework with the **OAuth 2.1 Provider plugin** (`@better-auth/oauth-provider`). Do NOT use the deprecated `oidcProvider` plugin from `better-auth/plugins` — it is being replaced by this one.

Work through the phases below **in order, one phase at a time**. At the end of each phase, verify every acceptance criterion, show me the verification output, and STOP for my confirmation before starting the next phase.

---

## 0. Reference documentation (read before writing any code)

Fetch and follow these — they are the source of truth over your training data:

- OAuth 2.1 Provider plugin: https://better-auth.com/docs/plugins/oauth-provider
- Better Auth installation: https://better-auth.com/docs/installation
- Better Auth basic usage: https://better-auth.com/docs/basic-usage
- Rate limiting concepts: https://better-auth.com/docs/concepts/rate-limit
- JWT plugin (JWKS): https://better-auth.com/docs/plugins/jwt

If the docs conflict with anything in this prompt, tell me before proceeding.

---

## 1. Stack (adjust only if I say so)

Scaffolded via **create-better-t-stack** with this configuration:

- **Frontend:** Next.js (App Router) — **Backend:** Self (fullstack)
- **Runtime:** managed by Next.js (scaffold runtime flag: `none`); deploy on Node.js
- **API layer:** none (the IdP's public API is the standard OAuth/OIDC endpoints served by the plugin — no tRPC/oRPC)
- **Language:** TypeScript, strict mode
- **Database:** PostgreSQL via Drizzle ORM, local dev via Docker (vendor-neutral; each brand deployment supplies its own `DATABASE_URL`)
- **Auth framework:** `better-auth` (scaffolded) + `@better-auth/oauth-provider` (added in Phase 2)
- **Addons:** Turborepo (monorepo: the IdP app, later `apps/test-rp`), Biome, Lefthook
- **Issuer URL:** one per brand deployment (e.g. `https://auth.<brand-domain>.com`), set via env — never hardcoded
- **Local dev issuer:** http://localhost:3000 (basePath `/api/auth` unless configured otherwise)
- **First-party apps (relying parties):** registered per deployment via the client seed script; ship the template with [LIST YOUR FIRST BRAND'S APPS + CALLBACK URLS, or placeholder demo apps]

**SINGLE-ORIGIN RULE (critical, satisfied by design with this stack):** the login/consent pages and `auth.handler` share one origin because the fullstack app serves both. Never restructure into a separate frontend and auth server on different origins — session cookies and the signed `oauth_query` redirect flow depend on same-origin serving.

## 2. Non-negotiable constraints

1. **Never hand-roll protocol or crypto.** All OAuth/OIDC endpoints, token issuance, PKCE validation, and JWKS come from the plugin. You write configuration, UI pages, client management, and glue code only.
2. **OAuth 2.1 defaults stay on.** PKCE (S256) required, `response_type=code` only, no implicit flow, no plain code challenge. Do not set `require_pkce: false` on any client unless I explicitly ask.
3. **Redirect URIs are exact-match allowlists.** No wildcards, no open redirects, no "starts with" matching anywhere in the codebase.
4. **`openid` scope must be configured** so the server is OIDC-compliant (discovery doc served at `{issuer}/.well-known/openid-configuration`).
5. **Secrets hygiene:** all secrets via environment variables; never committed; `client_secret` shown once at creation only (the DB stores it hashed by default — keep that default).
6. **HTTPS assumed in production**; secure, httpOnly, sameSite cookies.
7. Keep dynamic client registration **OFF** (`allowDynamicClientRegistration` unset/false) — all clients are first-party and registered by us.
8. Every phase ships with working code, not TODOs.
9. **Brand isolation:** every brand-specific value (name, logos, colors, legal links, issuer URL, contact info) lives ONLY in the `/branding` directory and `.env`. The rest of the codebase must be 100% brand-agnostic, so upstream template fixes merge cleanly into every brand's fork.

---

## Phase 0 — Scaffold with create-better-t-stack

- Scaffold the monorepo:

```bash
bun create better-t-stack@latest . \
  --frontend next --backend self --runtime none --api none \
  --database postgres --orm drizzle --db-setup docker \
  --auth better-auth --payments none \
  --addons turborepo biome lefthook --examples none
```

  This exact combination has been validated against the CLI (note: backend `self` requires `--runtime none`; `--payments none` prevents an interactive prompt). If a flag is still rejected due to a newer CLI release, run the CLI interactively and select the equivalent options; do not substitute different stack choices.
- Verify the scaffolded Docker Postgres, ORM connection, and Better Auth core setup all work, and that Better Auth's handler is mounted on the Next.js catch-all auth route.
- Extend `.env.example` to document every variable: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (the per-brand issuer), and placeholders for anything added later.

**Acceptance criteria:**
- [ ] Dev server starts; DB connects; healthcheck route returns 200.
- [ ] The scaffold's generated Better Auth config compiles and its migrations run.

## Phase 1 — Core authentication (the "who are you" layer)

- The scaffold already configures Better Auth core — review it, then ensure email + password authentication and sessions are enabled and migrated.
- Build minimal (unstyled is fine for now) `/sign-in` and `/sign-up` pages using the Better Auth client (replace or adapt any scaffolded auth pages).
- Add a seed script that creates one test user.

**Acceptance criteria:**
- [ ] Test user can sign up, sign in, sign out; session persists across reloads.
- [ ] Password hashing and session cookies use Better Auth defaults (no custom crypto).

## Phase 2 — Mount the OAuth 2.1 Provider plugin

- Install `@better-auth/oauth-provider`.
- Mount `jwt()` (from `better-auth/plugins`) and `oauthProvider()` in the auth config, following the installation docs, e.g.:

```ts
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";

export const auth = betterAuth({
  plugins: [
    jwt(),
    oauthProvider({
      loginPage: "/sign-in",
      consentPage: "/consent",           // REQUIRED in this plugin
      scopes: ["openid", "profile", "email", "offline_access"],
      // validAudiences: ["[https://api.<brand-domain>.com — set per deployment]"],
    }),
  ],
});
```

- Run the plugin's DB migration (adds `oauthClient`, `oauthAccessToken`, `oauthRefreshToken`, `oauthConsent`).
- Mount the frontend client plugin `oauthProviderClient()` from `@better-auth/oauth-provider/client` in the auth client — this is what auto-forwards the signed `oauth_query` parameter through the login/consent flow.
- Confirm the well-known endpoints reach `auth.handler`. If the framework's catch-all route doesn't cover them, add explicit routes using the exported helpers (`oauthProviderOpenIdConfigMetadata`, `oauthProviderAuthServerMetadata`).

**Acceptance criteria:**
- [ ] `GET {issuer}/.well-known/openid-configuration` returns valid JSON with `authorization_endpoint`, `token_endpoint`, `jwks_uri`, `userinfo_endpoint`, `issuer` matching config.
- [ ] `GET {issuer}/.well-known/oauth-authorization-server` returns valid RFC 8414 metadata.
- [ ] JWKS endpoint returns at least one signing key.

## Phase 3 — Client management (register the first-party apps)

- Write a server-side seed/provisioning script using `auth.api.adminCreateOAuthClient` to register each first-party app as a **confidential** client with:
  - exact `redirect_uris`
  - `skip_consent: true` (first-party → no consent screen)
  - `enable_end_session: true` (allow RP-initiated logout)
  - `name`, `icon`, and `uri` populated (displayed on the consent screen when a client requires consent)
- For any SPA/mobile client I listed, register it as a **public** client (`token_endpoint_auth_method: "none"`) — PKCE is enforced automatically.
- Add the registered client IDs to `cachedTrustedClients` in the plugin config for performance and to lock them against CRUD changes.
- Print each `client_id` + `client_secret` ONCE at creation with a warning to store them securely.
- Build a tiny internal admin page or CLI commands for: list clients, rotate a client secret (`rotateClientSecret`), disable a client.

**Acceptance criteria:**
- [ ] Seed script is idempotent (re-running doesn't duplicate clients).
- [ ] Attempting to register a redirect URI mismatch at authorize time is rejected.
- [ ] Secret rotation works and old secret stops working immediately.

## Phase 4 — Branding layer (the ONE folder edited per brand)

Goal: the entire visual identity of this IdP is driven from a single `/branding` folder, so re-branding for a new deployment means editing config values and swapping asset files — nothing else. The login page always shows THIS deployment's brand, regardless of which client app initiated the flow.

- Create the single source of truth `branding/config.ts` exporting: `brandName`, `logoLight`/`logoDark` (paths), `favicon`, `primaryColor`, `backgroundColor`, `accentColor`, `fontFamily`, `supportUrl`, `termsUrl`, `privacyUrl`.
- `branding/assets/` holds the logo, favicon, and any background imagery. No brand asset may live anywhere else.
- Generate CSS variables from the config (build-time or in a shared root layout) and consume them in ALL user-facing surfaces: `/sign-in`, `/sign-up`, `/consent`, error pages, and transactional email templates (verification, password reset).
- Rebuild `/sign-in` and `/sign-up` as polished, accessible, production-quality pages on top of this layer.
- Flow rules from the plugin docs still apply, independent of branding:
  - Preserve and forward the signed `oauth_query` from the `/oauth2/authorize` redirect — the `oauthProviderClient` plugin does this automatically for its endpoints; do not strip it or inject your own params into it.
  - After successful sign-in, do NOT manually redirect back to the app — the plugin continues the authorization flow automatically once the session is created.
- Ship the template with a neutral placeholder brand (e.g. "Acme ID") that proves the whole UI re-skins from `/branding` alone.

**Acceptance criteria:**
- [ ] Changing `branding/config.ts` values + swapping files in `branding/assets/` re-brands every auth screen and email with zero edits elsewhere.
- [ ] Grepping for the placeholder brand name outside `/branding` returns nothing.
- [ ] The login page renders identically no matter which `client_id` initiated the flow.
- [ ] Completing login redirects back to the initiating app's callback with `code`, `state`, and `iss` params.
- [ ] A user already holding an IdP session skips the login page entirely (silent SSO).
- [ ] Tampering with `oauth_query` fails safely with a branded error page, not a crash.

## Phase 5 — Consent page (for future non-trusted clients)

- Build `/consent`: display client name/icon (via the public client endpoint) and the requested scopes in human-readable form, with Approve/Deny.
- On approve: `authClient.oauth2.consent({ accept: true })`. On deny: `accept: false`.
- Style it with the same `/branding` layer (the page is brand-branded; the requesting client's name/icon appears only as content within it).
- Verify trusted clients (`skip_consent: true`) never see this page.

**Acceptance criteria:**
- [ ] A test client WITHOUT `skip_consent` triggers the consent screen once; consent is remembered on the next authorization.
- [ ] Denial returns the standard OAuth error to the client's redirect URI.
- [ ] Users can view and revoke their consents (simple account page using `getConsents` / `deleteConsent`).

## Phase 6 — Hardening & production configuration

- **Token lifetimes:** keep plugin defaults (access 1h, id_token 10h, refresh 30d, code 10m) unless I override; expose them as config constants. Use `scopeExpirations` to give any high-privilege scopes short lifetimes (5–15m).
- **Revocation & compromise response (design for "JWT can't be un-issued"):** wire `/oauth2/revoke` into an admin action ("kill this user's tokens") that revokes all of a user's refresh tokens and sessions, cutting off new token issuance instantly. Document the residual exposure: already-issued JWTs stay valid up to their remaining TTL on locally-verified endpoints. For sensitive operations in relying-party APIs, document (in INTEGRATION.md) the hybrid pattern: verify JWTs locally for normal traffic, but call `/oauth2/introspect` on high-stakes endpoints so revoked tokens fail immediately there. Note the nuclear option — signing-key rotation via the JWT plugin invalidates ALL outstanding tokens — and reserve it for RUNBOOK incident response.
- **Token prefixes:** set `prefix.opaqueAccessToken`, `prefix.refreshToken`, `prefix.clientSecret` (for secret-scanner compatibility) BEFORE first production deploy, and document that they're immutable afterwards.
- **Rate limiting:** enable Better Auth global rate limiting in production; keep the plugin's per-endpoint OAuth defaults; document them in the README.
- **Subject strategy:** default `sub` is the internal user ID across all clients (public subject type). Add a commented-out `pairwiseSecret` config block with a doc note: enabling pairwise later changes nothing for existing public clients, but the secret must be ≥32 chars and is permanent once set. ASK ME which mode we want before finishing this phase.
- **RP-initiated logout:** wire the end-session flow for trusted clients (`enable_end_session`), including `postLogoutRedirectUris`.
- **Security headers** (CSP, HSTS, X-Frame-Options DENY on auth pages), CSRF posture documented, audit logging of: login success/failure, token issuance, client secret rotation, consent grant/revoke.
- Add basic anomaly-visibility: failed-login counter per account with temporary lockout/backoff.

**Acceptance criteria:**
- [ ] `npm run build` succeeds with production config; all env vars documented.
- [ ] Automated tests cover: authorize→token happy path, PKCE failure, bad redirect_uri, expired code, refresh rotation (old refresh token invalid after use), revocation, introspection.

## Phase 7 — Verification with a real relying party

- Create a **separate minimal app in the monorepo** (`apps/test-rp`, own port) that integrates against the IdP using a standard OIDC client library (e.g. `openid-client`) configured ONLY from the discovery URL — no hardcoded endpoints.
- Implement in the RP: login (authorization code + PKCE + state), ID token validation (signature via JWKS, `iss`, `aud`, `exp`, `nonce`), userinfo call, refresh, logout.
- Then repeat with a SECOND RP client to prove SSO: log into RP1, open RP2, confirm no credentials are asked.
- Write the end-to-end verification as **Playwright browser tests** (not just HTTP-level tests): drive a real browser through login on RP1, assert the callback receives `code`, `state`, and `iss`, then open RP2 and assert silent SSO (no login form shown). Include a test that logs out via the end-session flow and asserts both RPs lose access.
- Verify access tokens as a resource server using `verifyAccessToken` (issuer + audience checked), per the docs' recommendation to prefer JWT access tokens.

**Acceptance criteria:**
- [ ] Full E2E: RP1 login → tokens valid → RP2 silent SSO → refresh works → RP-initiated logout ends the session.
- [ ] ID token validates with an off-the-shelf library using ONLY the discovery document (this is the OIDC-compliance proof).
- [ ] Authorization responses include the `iss` parameter (RFC 9207).

## Phase 8 — Documentation & handoff

- `README.md`: architecture diagram (mermaid ok), env vars, how to register a new client app, how to run migrations, how to rotate secrets/keys.
- `NEW_BRAND.md` (the core doc for this repo's purpose): exact steps to deploy for a new brand — clone the template (or GitHub "Use this template"), edit `branding/config.ts` + swap `branding/assets/`, set env (issuer URL, DB, `BETTER_AUTH_SECRET`, token prefixes), run migrations, run the client seed script for that brand's apps, deploy. Include how a brand fork pulls upstream template fixes later (`git remote add upstream` + merge) and note that constraint #9 (brand isolation) is what keeps those merges conflict-free.
- `RUNBOOK.md`: incident procedures — leaked client secret, leaked signing key, disabling a compromised client, revoking a user's tokens.
- `INTEGRATION.md` for app teams: discovery URL, required scopes, example code for integrating a new app in <1 hour.

**Acceptance criteria:**
- [ ] Following `NEW_BRAND.md` from a fresh clone produces a fully re-branded, working IdP deployment without touching any file outside `/branding` and `.env`.
- [ ] A new engineer can register a new client app end-to-end using only the docs.

---

## Working rules for you (the agent)

1. One phase at a time. Show verification evidence (command output, test results, curl responses) before moving on.
2. If a Better Auth API in the docs differs from what's in the installed version, flag it and follow the installed version's types. If you have a documentation-lookup tool available (e.g. Context7), use it to verify library APIs (Better Auth, Drizzle, Next.js, openid-client) before writing code against them — do not rely on memory for `@better-auth/oauth-provider` specifics.
3. Ask me before: adding dependencies beyond the stack, changing token lifetimes, enabling dynamic registration, or deviating from any constraint in section 2.
4. Prefer boring, readable code over cleverness. No premature abstraction.
5. Anything marked [REPLACE] that I haven't filled in: ask me at the start of Phase 0, once, as a single list of questions.
