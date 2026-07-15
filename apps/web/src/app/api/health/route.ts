import { ping } from "@krazil-idp/db";

export async function GET() {
	try {
		await ping();
		return Response.json({ status: "ok", database: "up" });
	} catch (error) {
		console.error("healthcheck: database unreachable", error);
		return Response.json(
			{ status: "degraded", database: "down" },
			{ status: 503 },
		);
	}
}
