import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { db, exceptions, rules, loanRecords } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { problemHandler } from "@/lib/problem";
import { tapeCounts } from "@/lib/service/review";

export const GET = problemHandler(async (req, ctx: unknown) => {
  await requireRole("tape:read");
  const { params } = ctx as unknown as { params: Promise<{ id: string }> };
  const { id } = await params;
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
  const cursor = url.searchParams.get("cursor");
  const severity = url.searchParams.getAll("severity");
  const status = url.searchParams.getAll("status");
  const ruleCode = url.searchParams.get("rule");

  const where = [eq(exceptions.tapeId, id)];
  if (severity.length) where.push(inArray(exceptions.severity, severity as never));
  if (status.length) where.push(inArray(exceptions.status, status as never));
  if (ruleCode) where.push(eq(rules.code, ruleCode));
  if (cursor) where.push(gt(exceptions.id, cursor));

  const rows = await db.select({ exc: exceptions, rule: rules, loanId: loanRecords.loanId })
    .from(exceptions).innerJoin(rules, eq(rules.id, exceptions.ruleId))
    .leftJoin(loanRecords, eq(loanRecords.id, exceptions.recordId))
    .where(and(...where)).orderBy(asc(exceptions.id)).limit(limit + 1);

  const page = rows.slice(0, limit);
  return Response.json({
    items: page.map((r) => ({
      id: r.exc.id, loanId: r.loanId, field: r.exc.field, observed: r.exc.observed,
      expected: r.exc.expected, severity: r.exc.severity, status: r.exc.status,
      clusterKey: r.exc.clusterKey,
      rule: { code: r.rule.code, name: r.rule.name, category: r.rule.category, description: r.rule.description },
    })),
    nextCursor: rows.length > limit ? page[page.length - 1]?.exc.id : null,
    counts: (await tapeCounts(id)).bySeverity,
  });
});
