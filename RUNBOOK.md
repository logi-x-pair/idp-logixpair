# Identity Provider incident runbook

All actions below are security-sensitive. Record the operator, timestamp, affected identifiers, reason, and results in the incident system. Never test these procedures against a shared or production database without an active incident and explicit approval.

## Leaked client secret

1. Identify the `client_id` and whether it is listed in `OAUTH_TRUSTED_CLIENT_IDS`.
2. If cached trusted, remove the ID from the environment and redeploy/restart first. The OAuth Provider's in-memory trusted cache has no expiry and rejects rotation endpoints.
3. Rotate:

   ```bash
   bun run --cwd apps/web clients rotate <client_id>
   ```

4. Store the new secret in the relying party's secret manager immediately. The CLI prints it once; the database stores only a hash.
5. Update/restart the relying party.
6. Verify the old secret returns `401 invalid_client` and the new secret authenticates.
7. Re-add the ID to `OAUTH_TRUSTED_CLIENT_IDS` and redeploy if trusted caching is still desired.

Rotation through the plugin invalidates the old secret immediately for uncached clients.

## Disable a compromised client

1. Remove the client ID from `OAUTH_TRUSTED_CLIENT_IDS` and restart. A cached client can remain active from memory after a DB-only change.
2. Disable it:

   ```bash
   bun run --cwd apps/web clients disable <client_id>
   ```

3. Restart all IdP instances and confirm authorization/token requests fail.
4. Investigate the configured exact redirect and post-logout URLs.
5. Re-enable only after remediation:

   ```bash
   bun run --cwd apps/web clients enable <client_id>
   ```

Plugin 1.6.23 does not expose `disabled` in `adminUpdateOAuthClient`; the operator CLI updates the column directly and warns when a restart is required.

## Revoke one user's tokens and sessions

```bash
bun run --cwd apps/web revoke-user <email>
```

This immediately:

- deletes Better Auth sessions, blocking new authorizations;
- marks every refresh token revoked, blocking new access-token issuance;
- deletes stored opaque access tokens.

Revocation behavior depends on the configured resource-server mode:

- `short-lived`: authorization-code JWTs remain usable by raw local JWKS
  verification until their 10-minute TTL; machine tokens retain their
  one-hour TTL. Introspection sees a denylisted JWT as inactive, but raw local
  verification does not consult the database.
- `hybrid`: high-risk routes reject a denylisted JWT when the resource server
  forwards its verified `jti` to the status endpoint; normal local-only routes
  retain the JWT TTL behavior. Session termination is also enforced by the
  status check.
- `immediate`: every status-aware protected route rejects a denylisted JWT on
  its next check, as well as rejecting deleted-session user tokens and disabled
  machine clients.

`revoke-user` does not enumerate already-issued JWTs, so use the single-token
operation below when the JWT itself is known. Signing-key rotation remains the
global emergency fallback.

## Revoke one known JWT access token

```bash
bun run --cwd apps/web revoke-token <jwt_access_token>
```

The CLI verifies the JWT signature, issuer, configured audience, expiration,
`jti`, and OAuth client `azp` before inserting one row into `revoked_token`.
The row is retained only until the token expires; repeated revocation is
idempotent. The plaintext token is never printed. A failed verification or
database write is an error and does not claim success.

The authenticated `/oauth2/revoke` endpoint applies the same signed-claim and
`azp` ownership checks for a client-requested JWT revocation. Both paths affect
OAuth introspection and the private `token-revocation-status` endpoint. Resource
servers must forward `jti` with `sid`/`sub` or `azp`; raw JWKS-only verification
cannot observe the denylist.

## Leaked signing key: nuclear rotation

This is the only way to invalidate every outstanding JWT before expiry. It also signs every user out of every relying party and can cause an outage if JWKS caches are stale.

1. Declare a security incident and obtain approval.
2. Put the IdP in a controlled maintenance window; stop token issuance on every instance.
3. Back up the `jwks` table/key store and record current `kid` values.
4. Remove/expire all compromised private/public key rows in the configured JWT key store using an approved database change—not an ad-hoc application request.
5. Restart one IdP instance and request `/api/auth/jwks`; Better Auth generates a new Ed25519 pair when no active pair exists.
6. Confirm the new JWKS has a new `kid`; old JWT signatures must fail.
7. Restart the rest of the fleet and purge CDN/resource-server JWKS caches.
8. Verify new authorization-code exchange and `verifyAccessToken` succeed; verify a captured old JWT fails.
9. Preserve the backup under incident retention policy, then close maintenance.

Do not use the JWT plugin's normal `gracePeriod` rotation for a compromise: retaining the old public key intentionally keeps old tokens valid during grace. Emergency rotation requires removing the compromised key from the active JWKS.

## Failed-login anomaly / lockout

After five failed attempts, the database-backed lockout applies exponential backoff starting at one minute, capped at one hour. Audit events are emitted as one-line JSON:

- `login.failure`
- `login.locked_out`
- `login.two_factor_failure`
- `login.success`

Investigate credential stuffing by email and source IP. Do not manually clear a real user's row without identity verification and an incident record.

## User two-factor enrollment and recovery

`TWO_FACTOR_ENABLED=true` exposes opt-in TOTP enrollment in the authenticated account page. The server and client 2FA plugins remain mounted when the flag is false; setting it false hides new enrollment but does not bypass an already-enrolled user's challenge. Use the password-gated account disable flow to remove 2FA from an account. Never edit the encrypted `two_factor` secret or backup-code fields directly.

The account lockout budget allows five failed TOTP/backup-code attempts and then applies the configured 15-minute lockout. A user can recover with one unused backup code after the lock expires, or an operator can follow the verified account-recovery process outside this application. Noninteractive CLI scripts refuse an enrolled admin's `twoFactorRedirect`; keep a dedicated non-2FA bootstrap operator for automation.

## Audit events

The auth hook emits structured JSON for login (including `login.two_factor_failure`), token issuance/revocation, OAuth client create/update/delete and secret rotation, and consent grant/deny/revoke. Ship stdout to the production logging/SIEM pipeline. Audit records must not contain passwords, client secrets, tokens, authorization codes, or token-bearing email URLs.

## RP-initiated logout limitation

`/oauth2/end-session` ends the IdP browser session. It cannot delete another relying party's local session cookie. Each RP must clear its own local session before redirecting to end-session; multi-RP single logout requires explicit front/back-channel coordination outside the currently installed plugin. The test harness demonstrates this with a clearly labelled `RP_PEER_LOGOUT_URL` callback and does not claim end-session alone clears RP2.

## Adopting migrations on a push-managed database

A development database provisioned with `bun run db:push` has no migration
bookkeeping. Running `bun run db:migrate` against it replays `0000` onto
existing tables and aborts (`relation "user" already exists`). Baseline it once:

```bash
bun run db:baseline   # inserts journal hashes; refuses if tables are missing
bun run db:migrate    # then applies only migrations newer than the baseline
```

`db:baseline` is idempotent (re-running reports "already baselined") and refuses
to run against a partially migrated database. Verify the committed migration
chain still matches the schema on a throwaway database as a re-runnable drill:

```bash
docker exec krazil-idp-postgres psql -U postgres -c 'CREATE DATABASE krazil_idp_migrate_check'
cd packages/db && DATABASE_URL=postgresql://postgres:$POSTGRES_PASSWORD@localhost:5433/krazil_idp_migrate_check bunx drizzle-kit migrate
DATABASE_URL=postgresql://postgres:$POSTGRES_PASSWORD@localhost:5433/krazil_idp_migrate_check bunx drizzle-kit push   # must report "No changes detected"
docker exec krazil-idp-postgres psql -U postgres -c 'DROP DATABASE krazil_idp_migrate_check'
```

## Deployment configuration

- Set `TRUSTED_PROXIES` to the IPs/CIDRs of your reverse proxies so Better Auth
  trusts `x-forwarded-for` only from those hops. Without it the first forwarded
  value is trusted blindly and any client can spoof its rate-limit and audit IP.
  Leave it empty only when the proxy strips inbound forwarding headers.
- Set `RATE_LIMIT_STORAGE=database` before running more than one instance;
  in-memory counters are per-process and reset on restart. The `rate_limit`
  table ships in migration `0003`.
