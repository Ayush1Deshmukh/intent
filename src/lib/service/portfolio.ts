import { and, asc, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import {
  db, tapes, loanRecords, exceptions, rules, verifiedRecords, attestations,
  auditEvents, users, proposals, rawRecords, sourceFiles,
} from "@/lib/db";
import { CANONICAL_FIELDS } from "@/lib/schema/fields";

/**
 * Portfolio-scoped reads.
 *
 * The rest of the API is tape-scoped, because that is how the workflow runs: you upload
 * a tape, you work its queue, you sign it off. But a consumer integrating with this
 * system does not think in tapes — they think in loans, and they want to ask about one
 * loan without first knowing which tape it arrived on. These functions serve that view,
 * and every one of them takes an optional tapeId for callers who do know.
 */

/** Newest first, because a caller who omits tapeId almost always means "the current one". */
export async function resolveTapeId(tapeId?: string | null): Promise<string | null> {
  if (tapeId) return tapeId;
  const [t] = await db.select({ id: tapes.id }).from(tapes).orderBy(desc(tapes.createdAt)).limit(1);
  return t?.id ?? null;
}

export type LoanQuery = {
  tapeId?: string | null; status?: string[]; q?: string | null;
  limit?: number; cursor?: string | null;
};

export async function listLoans({ tapeId, status, q, limit = 50, cursor }: LoanQuery) {
  const where = [];
  if (tapeId) where.push(eq(loanRecords.tapeId, tapeId));
  if (status?.length) where.push(inArray(loanRecords.verificationStatus, status as never));
  if (cursor) where.push(gt(loanRecords.id, cursor));
  if (q) {
    const like = `%${q}%`;
    where.push(or(
      sql`${loanRecords.loanId} ILIKE ${like}`,
      sql`${loanRecords.borrowerId} ILIKE ${like}`,
    )!);
  }

  const rows = await db.select().from(loanRecords)
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(loanRecords.id)).limit(limit + 1);

  const page = rows.slice(0, limit);
  return {
    items: page.map(canonical),
    nextCursor: rows.length > limit ? page[page.length - 1]?.id ?? null : null,
  };
}

/** One loan, with everything a reader needs to judge it: exceptions, decisions, source row. */
export async function getLoan(loanId: string, tapeId?: string | null) {
  const where = [eq(loanRecords.loanId, loanId)];
  if (tapeId) where.push(eq(loanRecords.tapeId, tapeId));

  const [rec] = await db.select().from(loanRecords)
    .where(and(...where)).orderBy(desc(loanRecords.version)).limit(1);
  if (!rec) return null;

  const [excs, props, raw, sealed] = await Promise.all([
    db.select({ exc: exceptions, rule: rules }).from(exceptions)
      .innerJoin(rules, eq(rules.id, exceptions.ruleId))
      .where(eq(exceptions.recordId, rec.id)),
    db.select({ p: proposals }).from(proposals)
      .innerJoin(exceptions, eq(exceptions.id, proposals.exceptionId))
      .where(eq(exceptions.recordId, rec.id)),
    db.select({ r: rawRecords, f: sourceFiles }).from(rawRecords)
      .innerJoin(sourceFiles, eq(sourceFiles.id, rawRecords.sourceFileId))
      .where(eq(rawRecords.id, rec.rawRecordId)).limit(1),
    db.select().from(verifiedRecords).where(eq(verifiedRecords.loanRecordId, rec.id)).limit(1),
  ]);

  return {
    loan: canonical(rec),
    verificationStatus: rec.verificationStatus,
    version: rec.version,
    recordHash: rec.recordHash,
    source: raw[0] ? {
      filename: raw[0].f.filename, sha256: raw[0].f.sha256,
      rowNumber: raw[0].r.rowNumber, original: raw[0].r.original,
    } : null,
    exceptions: excs.map((e) => ({
      id: e.exc.id, rule: e.rule.code, name: e.rule.name, severity: e.exc.severity,
      status: e.exc.status, field: e.exc.field, observed: e.exc.observed, expected: e.exc.expected,
    })),
    proposals: props.map(({ p }) => ({
      id: p.id, field: p.field, from: p.fromValue, to: p.toValue, status: p.status,
      source: p.source, model: p.model, confidence: p.confidence, rationale: p.rationale,
    })),
    verified: sealed[0] ? {
      recordHash: sealed[0].recordHash, verifiedBy: sealed[0].verifiedByEmail,
      at: sealed[0].createdAt, eventSeq: sealed[0].eventSeq,
    } : null,
  };
}

/**
 * Every audit event that touches one loan.
 *
 * The chain itself is tape-scoped and append-only; this is a projection of it, filtered
 * to the entities that belong to this loan — the record, its exceptions, its proposals.
 * The `seq` values are the real ones, so a reader can find each event in the full chain
 * and check it there.
 */
export async function loanAudit(loanId: string, tapeId?: string | null) {
  const where = [eq(loanRecords.loanId, loanId)];
  if (tapeId) where.push(eq(loanRecords.tapeId, tapeId));
  const [rec] = await db.select().from(loanRecords).where(and(...where)).limit(1);
  if (!rec) return null;

  const excIds = (await db.select({ id: exceptions.id }).from(exceptions)
    .where(eq(exceptions.recordId, rec.id))).map((e) => e.id);
  const propIds = excIds.length
    ? (await db.select({ id: proposals.id }).from(proposals)
        .where(inArray(proposals.exceptionId, excIds))).map((p) => p.id)
    : [];

  const ids = [rec.id, ...excIds, ...propIds];
  const rows = await db.select({ e: auditEvents, actor: users.email })
    .from(auditEvents).leftJoin(users, eq(users.id, auditEvents.actorId))
    .where(and(eq(auditEvents.tapeId, rec.tapeId), inArray(auditEvents.entityId, ids)))
    .orderBy(asc(auditEvents.seq));

  return {
    loanId, tapeId: rec.tapeId, recordId: rec.id,
    events: rows.map(({ e, actor }) => ({
      seq: e.seq, action: e.action, entityType: e.entityType, entityId: e.entityId,
      actor: actor ?? "system", actorRole: e.actorRole, at: e.createdAt,
      prevHash: e.prevHash, hash: e.hash, payload: e.payload,
    })),
  };
}

/** The portfolio at a glance — what a Data Consumer dashboard is actually asking for. */
export async function summary(tapeId?: string | null) {
  const scope = tapeId ? [eq(exceptions.tapeId, tapeId)] : [];

  const [tapeRows, recordCount, excRows, verifiedCount, atts] = await Promise.all([
    db.select({ id: tapes.id, name: tapes.name, status: tapes.status, createdAt: tapes.createdAt })
      .from(tapes).orderBy(desc(tapes.createdAt)).limit(20),
    db.select({ n: sql<number>`count(*)::int` }).from(loanRecords)
      .where(tapeId ? eq(loanRecords.tapeId, tapeId) : undefined),
    db.select({ severity: exceptions.severity, status: exceptions.status, n: sql<number>`count(*)::int` })
      .from(exceptions).where(scope.length ? and(...scope) : undefined)
      .groupBy(exceptions.severity, exceptions.status),
    db.select({ n: sql<number>`count(*)::int` }).from(verifiedRecords)
      .where(tapeId ? eq(verifiedRecords.tapeId, tapeId) : undefined),
    db.select().from(attestations).where(tapeId ? eq(attestations.tapeId, tapeId) : undefined),
  ]);

  const bySeverity: Record<string, number> = { BLOCKER: 0, CRITICAL: 0, WARNING: 0, INFO: 0 };
  const byStatus: Record<string, number> = {};
  let openGating = 0;
  for (const r of excRows) {
    bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + r.n;
    byStatus[r.status] = (byStatus[r.status] ?? 0) + r.n;
    if ((r.severity === "BLOCKER" || r.severity === "CRITICAL") &&
        (r.status === "OPEN" || r.status === "PENDING_APPROVAL")) openGating += r.n;
  }

  const records = recordCount[0]?.n ?? 0;
  const affected = await db.select({ n: sql<number>`count(distinct ${exceptions.recordId})::int` })
    .from(exceptions).where(scope.length ? and(...scope) : undefined);
  const dirty = affected[0]?.n ?? 0;

  return {
    scope: tapeId ? { tapeId } : { tapeId: null, note: "portfolio-wide; pass ?tapeId= to narrow" },
    tapes: tapeRows,
    records,
    /**
     * Clean rows over total rows. Deliberately not a weighted composite: a single
     * number that hides which rules failed is worse than no number, and the severity
     * breakdown beside it is what a reviewer would actually act on.
     */
    dataQuality: {
      cleanRows: records - dirty,
      rowsWithExceptions: dirty,
      score: records ? Number((((records - dirty) / records) * 100).toFixed(1)) : null,
      basis: "share of loan records carrying no exception of any severity",
    },
    exceptions: { total: excRows.reduce((a, r) => a + r.n, 0), bySeverity, byStatus, openGating },
    verified: { records: verifiedCount[0]?.n ?? 0, attestations: atts.length },
  };
}

/** A loan record reduced to the canonical fields, with nothing internal leaking out. */
function canonical(r: typeof loanRecords.$inferSelect) {
  const out: Record<string, unknown> = { id: r.id, tapeId: r.tapeId };
  for (const f of CANONICAL_FIELDS) {
    const v = (r as unknown as Record<string, unknown>)[f];
    out[f] = v instanceof Date ? v.toISOString() : v ?? null;
  }
  out.verificationStatus = r.verificationStatus;
  out.version = r.version;
  out.recordHash = r.recordHash;
  return out;
}
