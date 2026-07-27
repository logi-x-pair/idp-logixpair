import { ping } from "@krazil-idp/db";

import { healthResponse } from "./health-response";

export function GET(): Promise<Response> {
	return healthResponse({
		ping,
		createRequestId: () => crypto.randomUUID(),
		logFailure: (event) => console.error(JSON.stringify(event)),
	});
}
