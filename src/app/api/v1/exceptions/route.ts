import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { db, exceptions, rules, loanRecords } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { problemHandler } from "@/lib/problem";
import { resolveTapeId } from "@/lib/service/portfolio";

/** GET /exceptions — the queue, filterable, across tapes or within one. */
export const GET = problemHandler(async (req) => {
  await requireRole("tape:read");
  const url = new URL(req.url);
  const raw = url.searchParams.get("tapeId");
  const tapeId = raw === "all" ? null : await resolveTapeId(raw);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
  const cursor = url.searchParams.get("cursor");
  const severity = url.searchParams.getAll("severity");
  const status = url.searchParams.getAll("status");
  const ruleCode = url.searchParams.get("rule");

  const where = [];
  if (tapeId) where.push(eq(exceptions.tapeId, tapeId));
  if (severity.length) where.push(inArray(exceptions.severity, severity as never));
  if (status.length) where.push(inArray(exceptions.status, status as never));
  if (ruleCode) where.push(eq(rules.code, ruleCode));
  if (cursor) where.push(gt(exceptions.id, cursor));

  const rows = await db.select({ exc: exceptions, rule: rules, loanId: loanRecords.loanId })
    .from(exceptions).innerJoin(rules, eq(rules.id, exceptions.ruleId))
    .leftJoin(loanRecords, eq(loanRecords.id, exceptions.recordId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(exceptions.id)).limit(limit + 1);

  const page = rows.slice(0, limit);
  return Response.json({
    items: page.map((r) => ({
      id: r.exc.id, tapeId: r.exc.tapeId, loanId: r.loanId, field: r.exc.field,
      observed: r.exc.observed, expected: r.exc.expected, severity: r.exc.severity,
      status: r.exc.status, clusterKey: r.exc.clusterKey,
      rule: { code: r.rule.code, name: r.rule.name, category: r.rule.category },
    })),
    nextCursor: rows.length > limit ? page[page.length - 1]?.exc.id ?? null : null,
  });
});
