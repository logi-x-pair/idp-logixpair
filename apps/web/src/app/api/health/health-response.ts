export const DATABASE_UNREACHABLE_CODE = "DB_UNREACHABLE" as const;

export interface HealthFailureEvent {
	event: "healthcheck.database_unreachable";
	code: typeof DATABASE_UNREACHABLE_CODE;
	requestId: string;
}

export interface HealthResponseDependencies {
	ping: () => Promise<unknown>;
	createRequestId: () => string;
	logFailure: (event: HealthFailureEvent) => void;
}

export async function healthResponse({
	ping,
	createRequestId,
	logFailure,
}: HealthResponseDependencies): Promise<Response> {
	try {
		await ping();
		return Response.json({ status: "ok", database: "up" });
	} catch {
		const requestId = createRequestId();
		logFailure({
			event: "healthcheck.database_unreachable",
			code: DATABASE_UNREACHABLE_CODE,
			requestId,
		});
		return Response.json(
			{ status: "degraded", database: "down" },
			{ status: 503, headers: { "x-request-id": requestId } },
		);
	}
}
