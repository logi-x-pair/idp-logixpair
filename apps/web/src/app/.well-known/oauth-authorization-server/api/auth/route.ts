import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { auth } from "@krazil-idp/auth";

/**
 * RFC 8414 alias: `/.well-known/oauth-authorization-server/[issuer-path]`.
 * The Next.js catch-all auth route only covers `/api/auth/*`, so this
 * root-level alias needs an explicit route.
 */
export const GET = oauthProviderAuthServerMetadata(auth);
