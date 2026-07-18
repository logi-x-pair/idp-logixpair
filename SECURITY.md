# Security Policy

This repository is an OIDC identity provider template. Deployments handle
credentials, sessions, and tokens — treat every report seriously.

## Reporting a vulnerability

Email **nabil.muyassar.work@gmail.com** with a description, reproduction
steps, and impact. Do not open a public issue for exploitable findings.
You should receive an acknowledgement within 7 days.

## Scope notes for deployers

- Follow `RUNBOOK.md` for signing-key compromise and client-secret rotation.
- Keep `better-auth` / `@better-auth/oauth-provider` at the pinned versions or
  newer; the repo pins a patch for `1.6.23` (see README "Production notes").
- Never deploy with `SKIP_ENV_VALIDATION` set at runtime; the env schema and
  production guards in `packages/env/src/server.ts` are part of the security
  posture.

## Supported versions

The `main` branch only. Forked deployments should track upstream fixes.
