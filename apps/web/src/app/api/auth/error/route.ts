/**
 * Shadows Better Auth's built-in (unbranded) error page. Static route
 * segments take precedence over the [...all] catch-all, so OAuth protocol
 * errors redirected to `{basePath}/error` land on the branded /error page.
 */
export function GET(request: Request) {
	const url = new URL(request.url);
	return Response.redirect(new URL(`/error${url.search}`, url.origin), 302);
}
