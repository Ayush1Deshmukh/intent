/**
 * Bring an empty database to a working demo, idempotently.
 *
 * This is what the container runs on start, and what `npm run setup` runs locally.
 * It replaces "install drizzle-kit and tsx in the runtime image and hope the right
 * platform binaries came along" with one file that gets compiled to plain JavaScript
 * at build time — so the shipped image needs no build toolchain at all.
 *
 *   1 wait for the database to accept connections
 *   2 apply every drizzle/*.sql migration that has not run yet, in order,
 *     recording each one so a second start is a no-op
 *   3 seed the reference data (users, servicers, rules) if it is not there
 *   4 optionally build the pre-reviewed demo tape
 *
 * Every step is safe to repeat. `docker compose up` on the tenth run does nothing.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR || "drizzle";
const log = (s: string) => console.log(`verified-tape · ${s}`);

async function waitForDatabase(url: string, seconds = 60) {
  const deadline = Date.now() + seconds * 1000;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    const c = new Client({ connectionString: url });
    try {
      await c.connect();
      await c.end();
      return;
    } catch (e) {
      lastError = e;
      await c.end().catch(() => {});
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`the database did not accept connections within ${seconds}s: ${String(lastError)}`);
}

async function migrate(url: string) {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        tag         text PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )`);

    const { rows } = await client.query<{ tag: string }>("SELECT tag FROM _migrations");
    const done = new Set(rows.map((r) => r.tag));

    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
    let applied = 0;

    for (const file of files) {
      const tag = file.replace(/\.sql$/, "");
      if (done.has(tag)) continue;

      // drizzle separates statements with this marker; splitting on it rather than on
      // semicolons keeps function bodies and quoted semicolons intact
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      const statements = sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);

      await client.query("BEGIN");
      try {
        for (const statement of statements) await client.query(statement);
        await client.query("INSERT INTO _migrations (tag) VALUES ($1)", [tag]);
        await client.query("COMMIT");
        log(`applied ${tag} (${statements.length} statements)`);
        applied++;
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`${tag} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (applied === 0) log(`schema already up to date (${files.length} migrations)`);
  } finally {
    await client.end();
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set."); process.exit(1); }

  log("waiting for the database");
  await waitForDatabase(url);

  await migrate(url);

  // imported lazily, and only after the schema exists — these modules open a pool
  const { seedReference, DEMO_USERS, SERVICERS } = await import("@/lib/seed/reference");
  const { RULE_CATALOG } = await import("@/lib/rules/catalog");
  await seedReference();
  log(`seeded ${DEMO_USERS.length} users, ${SERVICERS.length} servicers, ${RULE_CATALOG.length} rules`);

  if (process.env.SEED_REVIEWED_TAPE === "true") {
    const { db, tapes } = await import("@/lib/db");
    const existing = await db.select({ id: tapes.id }).from(tapes).limit(1);
    if (existing.length > 0) {
      log("a tape already exists — skipping the pre-reviewed one");
    } else {
      log("building the pre-reviewed demo tape (about a minute)");
      const { buildReviewedTape } = await import("./seed-review");
      const r = await buildReviewedTape();
      log(`reviewed tape ready: ${r.sealed} loans sealed, ${r.excluded} excluded, verifies=${r.verifies}`);
    }
  }

  log("setup complete");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
