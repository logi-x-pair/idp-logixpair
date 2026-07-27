import { describe, expect, test } from "bun:test";

import {
	DATABASE_UNREACHABLE_CODE,
	type HealthFailureEvent,
	healthResponse,
} from "../src/app/api/health/health-response";

const SENTINELS = {
	url: "postgresql://sentinel-user:sentinel-password@sentinel-db.internal:5432/krazil_idp_test",
	host: "sentinel-db.internal",
	username: "sentinel-user",
	password: "sentinel-password",
	cause: "sentinel nested driver cause",
};

describe("health route contract", () => {
	test("returns the healthy public body after a successful database ping", async () => {
		const response = await healthResponse({
			ping: async () => undefined,
			createRequestId: () => "unused-request-id",
			logFailure: () => {
				throw new Error("healthy checks must not log failure events");
			},
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: "ok", database: "up" });
	});

	test("redacts database error details from degraded response and logs", async () => {
		const events: HealthFailureEvent[] = [];
		const response = await healthResponse({
			ping: async () => {
				throw new Error(SENTINELS.url, { cause: new Error(SENTINELS.cause) });
			},
			createRequestId: () => "health-request-123",
			logFailure: (event) => events.push(event),
		});
		const body = await response.text();
		const headers = JSON.stringify([...response.headers.entries()]);
		const logs = JSON.stringify(events);

		expect(response.status).toBe(503);
		expect(body).toBe('{"status":"degraded","database":"down"}');
		expect(response.headers.get("x-request-id")).toBe("health-request-123");
		expect(events).toEqual([
			{
				event: "healthcheck.database_unreachable",
				code: DATABASE_UNREACHABLE_CODE,
				requestId: "health-request-123",
			},
		]);
		for (const [outputName, output] of [
			["body", body],
			["headers", headers],
			["logs", logs],
		] as const) {
			for (const [sentinelName, sentinel] of Object.entries(SENTINELS)) {
				expect(output, `${sentinelName} leaked in ${outputName}`).not.toContain(
					sentinel,
				);
			}
		}
	});
});
