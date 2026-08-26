import { and, asc, eq, gt } from "drizzle-orm";
import { db, auditEvents } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { problemHandler } from "@/lib/problem";

export const GET = problemHandler(async (req, ctx: unknown) => {
  await requireRole("audit:read");
  const { params } = ctx as unknown as { params: Promise<{ id: string }> };
  const { id } = await params;
  const url = new URL(req.url);
  const after = Number(url.searchParams.get("after") ?? 0);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 1000);

  const rows = await db.select().from(auditEvents)
    .where(and(eq(auditEvents.tapeId, id), gt(auditEvents.seq, after)))
    .orderBy(asc(auditEvents.seq)).limit(limit + 1);

  return Response.json({
    items: rows.slice(0, limit),
    nextAfter: rows.length > limit ? rows[limit - 1].seq : null,
  });
});
