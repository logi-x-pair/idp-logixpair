import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { Pool } from "pg";

// Match drizzle.config.ts: the DATABASE_URL lives in the web app's env file.
dotenv.config({ path: "../../apps/web/.env" });

const scriptDir = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(scriptDir, "..", "migrations");

interface JournalEntry {
	idx: number;
	tag: string;
	when: number;
}

interface Journal {
	entries: JournalEntry[];
}

/**
 * One representative table per migration era, keyed by journal idx. The guard
 * only checks eras actually present in the journal at run time, so baselining
 * before a later migration is generated never demands its table. Update this
 * map when a fork adds a migration that creates a new headline table.
 */
const REPRESENTATIVE_TABLES: Record<number, string[]> = {
	0: ["user", "oauth_client"],
	1: ["revoked_token"],
	2: ["two_factor"],
	3: ["rate_limit"],
};

function fail(message: string): never {
	console.error(`db:baseline: ${message}`);
	process.exit(1);
}

async function main(): Promise<void> {
	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) {
		fail("DATABASE_URL is not set (expected in apps/web/.env).");
	}

	const journal = JSON.parse(
		readFileSync(join(migrationsDir, "meta", "_journal.json"), "utf8"),
	) as Journal;
	const entries = [...journal.entries].sort((a, b) => a.idx - b.idx);
	if (entries.length === 0) fail("migration journal is empty.");

	const migrations = entries.map((entry) => {
		const sqlText = readFileSync(
			join(migrationsDir, `${entry.tag}.sql`),
			"utf8",
		);
		return {
			tag: entry.tag,
			when: entry.when,
			hash: createHash("sha256").update(sqlText).digest("hex"),
		};
	});

	const pool = new Pool({ connectionString: databaseUrl });
	try {
		await pool.query("CREATE SCHEMA IF NOT EXISTS drizzle");
		await pool.query(
			`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
				id SERIAL PRIMARY KEY,
				hash text NOT NULL,
				created_at bigint
			)`,
		);

		const { rows } = await pool.query<{ n: number }>(
			"SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations",
		);
		const applied = rows[0]?.n ?? 0;
		if (applied === migrations.length) {
			console.log("db:baseline: already baselined; nothing to do.");
			return;
		}
		if (applied > 0) {
			fail(
				`bookkeeping table has ${applied} of ${migrations.length} rows — partially migrated. Reconcile drizzle.__drizzle_migrations manually before baselining.`,
			);
		}

		// Confirm the DB really is a fully pushed replica of the current schema
		// for every era in the journal, so we never mark unbuilt tables applied.
		const required = new Set<string>();
		for (const entry of entries) {
			for (const table of REPRESENTATIVE_TABLES[entry.idx] ?? []) {
				required.add(table);
			}
		}
		if (required.size > 0) {
			const present = await pool.query<{ table_name: string }>(
				`SELECT table_name FROM information_schema.tables
					WHERE table_schema = 'public' AND table_name = ANY($1)`,
				[[...required]],
			);
			const found = new Set(present.rows.map((r) => r.table_name));
			const missing = [...required].filter((t) => !found.has(t));
			if (missing.length > 0) {
				fail(
					`database schema does not match (missing: ${missing.join(", ")}); run 'bun run db:push' first, or run 'bun run db:migrate' against a fresh database instead.`,
				);
			}
		}

		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			for (const migration of migrations) {
				await client.query(
					"INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
					[migration.hash, migration.when],
				);
				console.log(`db:baseline: baselined ${migration.tag}`);
			}
			await client.query("COMMIT");
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	} catch (error) {
		fail(error instanceof Error ? error.message : String(error));
	} finally {
		await pool.end();
	}
}

await main();
