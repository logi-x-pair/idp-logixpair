"use client";

/**
 * Helpers for pages that participate in the OAuth authorization flow.
 *
 * When the OAuth provider redirects a user to /sign-in (or /sign-up), the URL
 * carries a signed `oauth_query` parameter. The `oauthProviderClient` plugin
 * forwards it automatically on auth requests, and the server continues the
 * authorization flow once a session is created — so pages must NOT manually
 * redirect in that case, and must preserve the query string when linking
 * between auth pages.
 */

/** True when the current page is part of an in-progress OAuth authorization flow. */
export function inOAuthFlow(): boolean {
	return new URLSearchParams(window.location.search).has("oauth_query");
}

/** Path with the current query string preserved (keeps `oauth_query` intact). */
export function withCurrentQuery(path: string): string {
	return `${path}${window.location.search}`;
}
