import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { HttpProblem, problemHandler } from "@/lib/problem";
import { seedReference } from "@/lib/seed/reference";

/** One click back to a clean demo, so the same story can be told to a second judge. */
export const POST = problemHandler(async (req) => {
  const token = req.headers.get("x-demo-token") ?? new URL(req.url).searchParams.get("token");
  if (!token || token !== process.env.DEMO_RESET_TOKEN) {
    throw new HttpProblem(403, "bad-demo-token", "This endpoint needs the demo reset token.");
  }
  await db.execute(sql`TRUNCATE tapes, users, rules, servicer_refs, audit_events, ai_cache, idempotency_keys, chain_lock RESTART IDENTITY CASCADE`);
  await seedReference();
  return Response.json({ ok: true, resetAt: new Date().toISOString() });
});
