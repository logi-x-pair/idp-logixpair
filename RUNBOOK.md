# Identity Provider incident runbook

All actions below are security-sensitive. Record the operator, timestamp, affected identifiers, reason, and results in the incident system. Never test these procedures against a shared or production database without an active incident and explicit approval.

## Leaked client secret

1. Identify the `client_id` and whether it is listed in `OAUTH_TRUSTED_CLIENT_IDS`.
2. If cached trusted, remove the ID from the environment and redeploy/restart first. The OAuth Provider's in-memory trusted cache has no expiry and rejects rotation endpoints.
3. Rotate:

   ```bash
   bun --cwd apps/web run clients rotate <client_id>
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
   bun --cwd apps/web run clients disable <client_id>
   ```

3. Restart all IdP instances and confirm authorization/token requests fail.
4. Investigate the configured exact redirect and post-logout URLs.
5. Re-enable only after remediation:

   ```bash
   bun --cwd apps/web run clients enable <client_id>
   ```

Plugin 1.6.23 does not expose `disabled` in `adminUpdateOAuthClient`; the operator CLI updates the column directly and warns when a restart is required.

## Revoke one user's tokens and sessions

```bash
bun --cwd apps/web run revoke-user <email>
```

This immediately:

- deletes Better Auth sessions, blocking new authorizations;
- marks every refresh token revoked, blocking new access-token issuance;
- deletes stored opaque access tokens.

Revocation behavior depends on the configured resource-server mode:

- `short-lived`: authorization-code JWTs remain usable by local verification
  until their 10-minute TTL; machine tokens retain their one-hour TTL.
- `hybrid`: high-risk routes reject deleted-session user JWTs at the next
  status check; normal local-only routes retain the JWT TTL behavior.
- `immediate`: every status-aware protected route rejects deleted-session user
  JWTs at the next check.

Raw JWKS verification and OAuth Provider 1.6.23 `/oauth2/introspect` still
report deleted-session JWTs as active until expiry. Machine-to-machine status
checks use `azp` and the OAuth client enabled state. Individual JWT revocation
still requires an opaque token or a `jti`/token-hash denylist; key rotation is
the global emergency fallback.

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
- `login.success`

Investigate credential stuffing by email and source IP. Do not manually clear a real user's row without identity verification and an incident record.

## Audit events

The auth hook emits structured JSON for login, token issuance/revocation, client secret rotation, and consent grant/deny/revoke. Ship stdout to the production logging/SIEM pipeline. Audit records must not contain passwords, client secrets, tokens, authorization codes, or token-bearing email URLs.

## RP-initiated logout limitation

`/oauth2/end-session` ends the IdP browser session. It cannot delete another relying party's local session cookie. Each RP must clear its own local session before redirecting to end-session; multi-RP single logout requires explicit front/back-channel coordination outside the currently installed plugin. The test harness demonstrates this with a clearly labelled `RP_PEER_LOGOUT_URL` callback and does not claim end-session alone clears RP2.
