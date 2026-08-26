/**
 * The audit chain — the only door through which state changes.
 *
 * Every meaningful event is appended with hash(n) = sha256(hash(n-1) || event).
 * Editing or deleting event N breaks every link after it, which is detectable in
 * one linear pass. Appends are serialized through a single-row advisory lock:
 * two concurrent writers reading the same prevHash would fork the chain, and a
 * forked chain fails verification for reasons that have nothing to do with fraud.
 */
import { sql, desc, eq, asc, gt } from "drizzle-orm";
import { db, auditEvents } from "./db";
import { eventHash, GENESIS, ChainEvent } from "./hash";

export const AUDIT_ACTIONS = [
  "FILE_INGESTED", "MAPPING_PROPOSED", "MAPPING_CONFIRMED", "VALUE_COERCED",
  "RULES_RUN", "EXCEPTION_RAISED", "AI_PROPOSAL_CREATED", "PROPOSAL_ACCEPTED",
  "PROPOSAL_REJECTED", "CHANGE_APPROVED", "CHANGE_REJECTED", "EXCEPTION_WAIVED",
  "RULE_CREATED", "RULE_APPROVED", "TAPE_ATTESTED", "EXPORT_GENERATED",
  "CONFLICT_DETECTED", "LOGIN",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type NewEvent = {
  tapeId?: string | null;
  actorId?: string | null;
  actorRole?: "DATA_OPERATOR" | "REVIEWER" | "DATA_CONSUMER" | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  payload: unknown;
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Append one event. MUST be called inside the same transaction as the mutation, and BEFORE it. */
export async function emit(tx: Tx, e: NewEvent) {
  await tx.execute(sql`SELECT id FROM chain_lock WHERE id = 1 FOR UPDATE`);

  const [prev] = await tx.select({ seq: auditEvents.seq, hash: auditEvents.hash })
    .from(auditEvents).orderBy(desc(auditEvents.seq)).limit(1);

  const seq = (prev?.seq ?? 0) + 1;
  const prevHash = prev?.hash ?? GENESIS;
  const createdAt = new Date().toISOString();

  const chainEvent: ChainEvent = {
    seq, createdAt,
    actorId: e.actorId ?? null,
    actorRole: e.actorRole ?? null,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    payload: e.payload,
  };
  const hash = eventHash(prevHash, chainEvent);

  const [row] = await tx.insert(auditEvents).values({
    seq, tapeId: e.tapeId ?? null, actorId: e.actorId ?? null, actorRole: e.actorRole ?? null,
    action: e.action, entityType: e.entityType, entityId: e.entityId,
    payload: e.payload as object, prevHash, hash, createdAt,
  }).returning();

  return row;
}

/** Append several events in one lock acquisition — used by bulk ingest. */
export async function emitMany(tx: Tx, events: NewEvent[]) {
  if (events.length === 0) return [];
  await tx.execute(sql`SELECT id FROM chain_lock WHERE id = 1 FOR UPDATE`);
  const [prev] = await tx.select({ seq: auditEvents.seq, hash: auditEvents.hash })
    .from(auditEvents).orderBy(desc(auditEvents.seq)).limit(1);

  let seq = prev?.seq ?? 0;
  let prevHash = prev?.hash ?? GENESIS;
  const rows: (typeof auditEvents.$inferInsert)[] = [];

  for (const e of events) {
    seq += 1;
    const createdAt = new Date().toISOString();
    const chainEvent: ChainEvent = {
      seq, createdAt, actorId: e.actorId ?? null, actorRole: e.actorRole ?? null,
      action: e.action, entityType: e.entityType, entityId: e.entityId, payload: e.payload,
    };
    const hash = eventHash(prevHash, chainEvent);
    rows.push({
      seq, tapeId: e.tapeId ?? null, actorId: e.actorId ?? null, actorRole: e.actorRole ?? null,
      action: e.action, entityType: e.entityType, entityId: e.entityId,
      payload: e.payload as object, prevHash, hash, createdAt,
    });
    prevHash = hash;
  }

  // chunked so a 500-row ingest does not blow the parameter limit
  for (let i = 0; i < rows.length; i += 200) {
    await tx.insert(auditEvents).values(rows.slice(i, i + 200));
  }
  return rows;
}

export type ChainVerification = {
  ok: boolean;
  eventsChecked: number;
  firstBadSeq: number | null;
  reason: string | null;
};

/** Recompute the whole chain from genesis. O(n), and the point of the whole design. */
export async function verifyChain(fromSeq = 0): Promise<ChainVerification> {
  const rows = await db.select().from(auditEvents)
    .where(gt(auditEvents.seq, fromSeq)).orderBy(asc(auditEvents.seq));

  let prevHash = fromSeq === 0 ? GENESIS : (await db.select({ hash: auditEvents.hash })
    .from(auditEvents).where(eq(auditEvents.seq, fromSeq)).limit(1))[0]?.hash ?? GENESIS;

  let expectedSeq = fromSeq + 1;
  for (const r of rows) {
    if (r.seq !== expectedSeq) {
      return { ok: false, eventsChecked: expectedSeq - fromSeq - 1, firstBadSeq: expectedSeq,
        reason: `sequence gap: expected ${expectedSeq}, found ${r.seq} — an event was deleted` };
    }
    if (r.prevHash !== prevHash) {
      return { ok: false, eventsChecked: r.seq - fromSeq - 1, firstBadSeq: r.seq,
        reason: `event ${r.seq} does not link to event ${r.seq - 1}` };
    }
    const recomputed = eventHash(prevHash, {
      seq: r.seq,
      // pg hands the timestamp back in its own format; the hash was taken over the
      // ISO form, so normalize before recomputing or every event fails to verify
      createdAt: new Date(r.createdAt).toISOString(),
      actorId: r.actorId, actorRole: r.actorRole, action: r.action,
      entityType: r.entityType, entityId: r.entityId, payload: r.payload,
    });
    if (recomputed !== r.hash) {
      return { ok: false, eventsChecked: r.seq - fromSeq - 1, firstBadSeq: r.seq,
        reason: `event ${r.seq} content does not match its stored hash — it was edited in place` };
    }
    prevHash = r.hash;
    expectedSeq++;
  }
  return { ok: true, eventsChecked: rows.length, firstBadSeq: null, reason: null };
}
