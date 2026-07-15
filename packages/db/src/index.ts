import { env } from "@krazil-idp/env/server";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "./schema";

export function createDb() {
	return drizzle(env.DATABASE_URL, { schema });
}

export const db = createDb();

/** Cheap connectivity probe for healthchecks. Throws when the DB is unreachable. */
export async function ping() {
	await db.execute(sql`select 1`);
}
