import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Serves brand assets from `branding/assets/` at `/brand/<file>`. Keeping the
 * files in /branding (instead of public/) is what makes re-branding a
 * single-folder swap.
 */

const CONTENT_TYPES: Record<string, string> = {
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".ico": "image/x-icon",
};

/** Monorepo-root `branding/assets` dir, found by walking up from the app cwd. */
function findAssetsDir(): string | null {
	let dir = process.cwd();
	for (let depth = 0; depth < 5; depth++) {
		const candidate = path.join(dir, "branding", "assets");
		if (existsSync(candidate)) return candidate;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ path: string[] }> },
) {
	const assetsRoot = findAssetsDir();
	if (!assetsRoot) {
		console.error(
			"brand assets: branding/assets directory not found from",
			process.cwd(),
		);
		return new Response("branding assets not found", { status: 500 });
	}

	const { path: segments } = await params;
	const resolved = path.resolve(assetsRoot, ...segments);
	if (!resolved.startsWith(assetsRoot + path.sep)) {
		return new Response("not found", { status: 404 });
	}

	const contentType = CONTENT_TYPES[path.extname(resolved).toLowerCase()];
	if (!contentType) {
		return new Response("not found", { status: 404 });
	}

	try {
		const body = await readFile(resolved);
		return new Response(new Uint8Array(body), {
			headers: {
				"Content-Type": contentType,
				"Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
			},
		});
	} catch {
		return new Response("not found", { status: 404 });
	}
}
