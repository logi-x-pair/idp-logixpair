# New brand deployment

This repository is a white-label IdP template. A deployment's visual identity is fixed at deploy time; it never changes based on the requesting client application.

## 1. Create the deployment

Use GitHub's **Use this template** or clone the repository:

```bash
git clone <template-url> <brand-idp>
cd <brand-idp>
bun install
```

Brand-visible values live only under `branding/` and in deployment `.env` files. Application behavior, package names, and local infrastructure identifiers are deliberately shared across clones.

### Non-brand internals (deliberately unchanged)

Do not rename these solely for rebranding: `@krazil-idp/*` workspace package names, the Docker Compose project/container/volume names, `POSTGRES_DB`, and the disposable `krazil_idp_test` database name in `apps/web/scripts/setup-test-db.ts`. They are invisible to end users. Rename them only when multiple forks share a host, container registry, or database server and the infrastructure requires isolation.

## 2. Replace the brand

Edit `branding/config.ts`:

- `brandName`
- `logoLight`, `logoDark`, and `favicon` paths
- `primaryColor`, `backgroundColor`, `accentColor`
- `fontFamily`
- `supportUrl`, `termsUrl`, `privacyUrl`

Replace the corresponding files in `branding/assets/`. Do not put a logo, favicon, wordmark, or brand name in `apps/web/public`, `apps/web/src/app/favicon.ico`, shared UI, or email code. The asset route serves `/brand/*` from this folder.

Run a placeholder-brand check before committing:

```bash
grep -R "<old-placeholder>" . --exclude-dir=node_modules --exclude-dir=.next
```

Only `branding/` should contain deployment-specific brand values.

## 3. Configure deployment secrets

Copy the examples to untracked files:

```bash
cp apps/web/.env.example apps/web/.env
cp packages/db/.env.example packages/db/.env
```

Set, at minimum:

- `POSTGRES_PASSWORD` in `packages/db/.env`.
- `DATABASE_URL` for the deployment database.
- `BETTER_AUTH_SECRET` generated with `openssl rand -base64 32`.
- `BETTER_AUTH_URL` to the public issuer origin.
- `CORS_ORIGIN` to the same fullstack origin.
- Token prefixes before the first production deployment.
- `OAUTH_ADMIN_EMAILS`, `IDP_ADMIN_EMAIL`, and `IDP_ADMIN_PASSWORD` for the operator bootstrap; use a 12+ character admin password.
- `REQUIRE_EMAIL_VERIFICATION` if unverified password sign-in must be blocked after verification mail is sent.
- `TWO_FACTOR_ENABLED=true` to expose opt-in TOTP enrollment; the plugin remains mounted when false, so an already-enrolled account still requires 2FA.
- `MAILER_SMTP_HOST`, `MAILER_SMTP_PORT`, `MAILER_FROM` for transactional email (required in production); add `MAILER_SMTP_USER`/`MAILER_SMTP_PASS` unless your relay is IP-allowlisted. Works with any SMTP provider.
- `RATE_LIMIT_STORAGE=database` before running more than one instance (in-memory counters are per-process); the `rate_limit` table ships in migration `0003`.
- `TRUSTED_PROXIES` set to your reverse proxies' IPs/CIDRs when behind a proxy, so forwarded client IPs cannot be spoofed.

Never commit either `.env` file. Use a secret manager in production.

## 4. Register this brand's apps

Edit only `branding/clients.ts` for first-party clients. Replace the demo app names and exact callback/post-logout URLs with this brand's apps. Use:

```bash
bun run db:start
bun run db:push
bun --cwd apps/web run seed:admin
bun --cwd apps/web run seed:clients
```

The operator must be explicitly provisioned by `seed:admin`; public signup cannot assign the `admin` role. `seed:clients` is idempotent by client name. Capture each `client_secret` once and store it in the relying party's secret manager. Do not put it in this repository.

Use `skipConsent: true` only for first-party trusted clients. Keep `enableEndSession: true` and exact `postLogoutRedirectUris` for clients that support RP-initiated logout. Public clients must use `token_endpoint_auth_method: "none"`; PKCE remains required.

## 5. Deploy

```bash
bun install
# Fresh database:
bun run db:migrate
# Existing push-managed database: run `bun run db:baseline` once, then `bun run db:migrate`.
bun run build
bun --cwd apps/web run start
```

Set the platform's HTTPS hostname as `BETTER_AUTH_URL`. Verify:

```bash
curl -fsS "$BETTER_AUTH_URL/api/health"
curl -fsS "$BETTER_AUTH_URL/api/auth/.well-known/openid-configuration"
curl -fsS "$BETTER_AUTH_URL/api/auth/jwks"
```

The discovery document's `issuer` must exactly equal the configured issuer. Register that discovery URL with every relying party; do not hardcode token or authorization endpoints in app code.

## 6. Pull upstream fixes later

A brand fork can merge upstream template fixes without editing upstream source files:

```bash
git remote add upstream <template-repository-url>
git fetch upstream
git merge upstream/main
```

Constraint 9 is what keeps this merge path low-conflict: all brand-specific values and assets live in `branding/`, while application behavior remains brand-agnostic. Resolve only intentional changes in `branding/` and deployment environment files.

## 7. Handoff checklist

- [ ] `branding/config.ts` contains this deployment's values.
- [ ] `branding/assets/` contains the correct light logo, dark logo, and favicon.
- [ ] No old placeholder name remains outside `branding/`.
- [ ] Production HTTPS issuer and database are configured.
- [ ] `BETTER_AUTH_SECRET` and token prefixes are set and stored securely.
- [ ] Operator is provisioned and client seed output is stored securely.
- [ ] Discovery, JWKS, health, login, callback, logout, and a relying-party smoke test pass.
- [ ] `REQUIRE_EMAIL_VERIFICATION` and `TWO_FACTOR_ENABLED` have intentional values documented; setting the 2FA flag false does not disable already-enrolled accounts.
- [ ] SMTP mail is configured (`MAILER_SMTP_HOST` + `MAILER_FROM`, plus `MAILER_SMTP_USER`/`PASS` unless IP-allowlisted); the production mailer fails closed when host/from are absent.
- [ ] `RATE_LIMIT_STORAGE` and `TRUSTED_PROXIES` have intentional values for the deployment's instance count and proxy topology.
