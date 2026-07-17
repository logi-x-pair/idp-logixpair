"use client";

import type { Route } from "next";

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
	const params = new URLSearchParams(window.location.search);
	// Older provider versions wrapped the signed query in `oauth_query`;
	// current versions put the signed fields directly in the page query.
	return (
		params.has("oauth_query") || (params.has("sig") && params.has("ba_param"))
	);
}

/** Path with the current query string preserved (keeps `oauth_query` intact). */
export function withCurrentQuery(path: Route): Route {
	return `${path}${window.location.search}` as Route;
}
