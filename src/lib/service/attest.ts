import { and, asc, eq, inArray } from "drizzle-orm";
import {
  db, tapes, loanRecords, exceptions, rules, verifiedRecords, attestations,
  auditEvents, transformations, rawRecords, sourceFiles, proposals, decisions,
} from "@/lib/db";
import { emit, emitMany, verifyChain, NewEvent } from "@/lib/audit";
import { businessFields, merkleProof, merkleRoot, recordHash, verifyMerkleProof } from "@/lib/hash";
import { Session } from "@/lib/auth";
import { HttpProblem } from "@/lib/problem";
import { tapeCounts, recordValues } from "./review";

/**
 * Sign off a tape.
 *
 * Gate: no BLOCKER or CRITICAL exception may still be OPEN or PENDING_APPROVAL.
 * Then every eligible loan is sealed into the verified ledger with its own hash,
 * the hashes are rolled into a Merkle root, and the root is stored on the
 * attestation with the signer and the last event in the chain.
 */
export async function attestTape(session: Session, tapeId: string) {
  const [tape] = await db.select().from(tapes).where(eq(tapes.id, tapeId)).limit(1);
  if (!tape) throw new HttpProblem(404, "tape-not-found", "That tape does not exist.");

  const counts = await tapeCounts(tapeId);
  if (counts.openGating > 0) {
    const open = await db.select({ code: rules.code, name: rules.name, id: exceptions.id })
      .from(exceptions).innerJoin(rules, eq(rules.id, exceptions.ruleId))
      .where(and(eq(exceptions.tapeId, tapeId), inArray(exceptions.severity, ["BLOCKER", "CRITICAL"]),
                 inArray(exceptions.status, ["OPEN", "PENDING_APPROVAL"])))
      .limit(10);
    throw new HttpProblem(409, "open-gating-exceptions",
      `${counts.openGating} blocking or critical exceptions are still open. Resolve or reject them before signing off.`,
      { openCount: counts.openGating, sample: open });
  }

  const records = await db.select().from(loanRecords)
    .where(eq(loanRecords.tapeId, tapeId)).orderBy(asc(loanRecords.loanId));

  const gatingByRecord = new Set(
    (await db.select({ recordId: exceptions.recordId })
      .from(exceptions)
      .where(and(eq(exceptions.tapeId, tapeId), inArray(exceptions.severity, ["BLOCKER", "CRITICAL"]),
                 inArray(exceptions.status, ["OPEN", "PENDING_APPROVAL"]))))
      .map((r) => r.recordId).filter(Boolean) as string[]);

  // Three reasons a loan does not get sealed, and all three are reported rather
  // than silently dropped: it still carries a gating exception, it arrived with no
  // identifier, or a reviewer excluded it from the tape on the record.
  const excluded = records.filter((r) => r.verificationStatus === "REJECTED");
  const unidentified = records.filter((r) => r.verificationStatus !== "REJECTED" && !r.loanId);
  const eligible = records.filter((r) =>
    r.verificationStatus !== "REJECTED" && r.loanId && !gatingByRecord.has(r.id));

  if (eligible.length === 0) {
    throw new HttpProblem(409, "nothing-to-verify", "No loan on this tape is eligible for verification.");
  }

  const excByRecord = new Map<string, { code: string; severity: string; status: string }[]>();
  for (const row of await db.select({ recordId: exceptions.recordId, code: rules.code, severity: exceptions.severity, status: exceptions.status })
    .from(exceptions).innerJoin(rules, eq(rules.id, exceptions.ruleId)).where(eq(exceptions.tapeId, tapeId))) {
    if (!row.recordId) continue;
    if (!excByRecord.has(row.recordId)) excByRecord.set(row.recordId, []);
    excByRecord.get(row.recordId)!.push({ code: row.code, severity: row.severity, status: row.status });
  }

  const rawById = new Map((await db.select({
    id: rawRecords.id, rowNumber: rawRecords.rowNumber, original: rawRecords.original,
    filename: sourceFiles.filename, sha256: sourceFiles.sha256,
  }).from(rawRecords).innerJoin(sourceFiles, eq(sourceFiles.id, rawRecords.sourceFileId))
    .where(eq(sourceFiles.tapeId, tapeId))).map((r) => [r.id, r]));

  return db.transaction(async (tx) => {
    const leaves: { loanRecordId: string; loanId: string; hash: string }[] = [];
    const events: NewEvent[] = [];
    const verifiedRows: (typeof verifiedRecords.$inferInsert)[] = [];

    for (const rec of eligible) {
      const values = recordValues(rec);
      const hash = recordHash({ ...values, id: null, version: rec.version });
      leaves.push({ loanRecordId: rec.id, loanId: rec.loanId!, hash });

      const src = rawById.get(rec.rawRecordId);
      verifiedRows.push({
        tapeId, loanRecordId: rec.id, loanId: rec.loanId!,
        payload: businessFields(values) as object,
        lineage: {
          sourceFile: src?.filename ?? null,
          sourceFileSha256: src?.sha256 ?? null,
          sourceRow: src?.rowNumber ?? null,
          rawValues: src?.original ?? null,
          version: rec.version,
          rulesTriggered: excByRecord.get(rec.id) ?? [],
        } as object,
        recordHash: hash,
        verifiedById: session.userId, verifiedByEmail: session.email,
        eventSeq: 0,
      });
    }

    const root = merkleRoot(leaves.map((l) => l.hash));

    const attestEvent = await emit(tx, {
      tapeId, actorId: session.userId, actorRole: session.role,
      action: "TAPE_ATTESTED", entityType: "tape", entityId: tapeId,
      payload: {
        merkleRoot: root, recordCount: leaves.length, leaves, signer: session.email,
        excludedCount: excluded.length, unidentifiedCount: unidentified.length,
        excluded: excluded.map((r) => ({ recordId: r.id, loanId: r.loanId })),
      },
    });

    for (const v of verifiedRows) v.eventSeq = attestEvent.seq;
    await tx.delete(verifiedRecords).where(eq(verifiedRecords.tapeId, tapeId));
    for (let i = 0; i < verifiedRows.length; i += 200) {
      await tx.insert(verifiedRecords).values(verifiedRows.slice(i, i + 200));
    }

    await tx.update(loanRecords).set({ verificationStatus: "VERIFIED" })
      .where(and(eq(loanRecords.tapeId, tapeId), inArray(loanRecords.id, eligible.map((e) => e.id))));

    await tx.delete(attestations).where(eq(attestations.tapeId, tapeId));
    const [att] = await tx.insert(attestations).values({
      tapeId, merkleRoot: root, leaves, recordCount: leaves.length,
      signerId: session.userId, signerEmail: session.email, lastEventSeq: attestEvent.seq,
    }).returning();

    await tx.update(tapes).set({ status: "VERIFIED" }).where(eq(tapes.id, tapeId));
    if (events.length) await emitMany(tx, events);
    return att;
  });
}

export type TapeVerification = {
  ok: boolean;
  attested: boolean;
  chain: Awaited<ReturnType<typeof verifyChain>>;
  data: {
    ok: boolean;
    attestedRoot: string | null;
    recomputedRoot: string | null;
    recordCount: number;
    divergences: { loanId: string; attestedHash: string; recomputedHash: string; reason: string }[];
  };
  checkedAt: string;
};

/**
 * The endpoint behind the demo's last thirty seconds. Public on purpose: anyone
 * can check a tape, nobody can change it.
 */
export async function verifyTape(tapeId: string): Promise<TapeVerification> {
  const chain = await verifyChain();
  const [att] = await db.select().from(attestations).where(eq(attestations.tapeId, tapeId)).limit(1);

  if (!att) {
    return {
      ok: chain.ok, attested: false, chain,
      data: { ok: false, attestedRoot: null, recomputedRoot: null, recordCount: 0, divergences: [] },
      checkedAt: new Date().toISOString(),
    };
  }

  const verified = await db.select({ v: verifiedRecords, rec: loanRecords })
    .from(verifiedRecords)
    .innerJoin(loanRecords, eq(loanRecords.id, verifiedRecords.loanRecordId))
    .where(eq(verifiedRecords.tapeId, tapeId));

  // keyed by RECORD, not by loan id: duplicated loan ids are one of the defect
  // classes this system exists to catch, so the verifier cannot assume they are unique
  const attestedByRecord = new Map(att.leaves.map((l) => [l.loanRecordId, l.hash]));
  const divergences: TapeVerification["data"]["divergences"] = [];
  const recomputed: string[] = [];

  for (const { v, rec } of verified) {
    // recompute from the LIVE row, never from the stored hash
    const live = recordHash({ ...recordValues(rec), id: null, version: rec.version });
    recomputed.push(live);
    const attestedHash = attestedByRecord.get(v.loanRecordId);
    if (!attestedHash) {
      divergences.push({ loanId: v.loanId, attestedHash: "(absent)", recomputedHash: live,
        reason: "this loan was not part of the signed attestation" });
    } else if (attestedHash !== live) {
      divergences.push({ loanId: v.loanId, attestedHash, recomputedHash: live,
        reason: "the stored loan no longer matches the value that was signed off" });
    }
  }
  for (const leaf of att.leaves) {
    if (!verified.some((x) => x.v.loanRecordId === leaf.loanRecordId)) {
      divergences.push({ loanId: leaf.loanId, attestedHash: leaf.hash, recomputedHash: "(deleted)",
        reason: "a loan present at sign-off has been removed from the ledger" });
    }
  }

  const recomputedRoot = merkleRoot(recomputed);
  const dataOk = recomputedRoot === att.merkleRoot && divergences.length === 0;

  return {
    ok: chain.ok && dataOk, attested: true, chain,
    data: {
      ok: dataOk, attestedRoot: att.merkleRoot, recomputedRoot,
      recordCount: verified.length,
      divergences: divergences.slice(0, 25),
    },
    checkedAt: new Date().toISOString(),
  };
}

/** proof that one loan belongs to the signed set — verifiable without the database */
export async function loanProof(tapeId: string, loanId: string) {
  const [att] = await db.select().from(attestations).where(eq(attestations.tapeId, tapeId)).limit(1);
  if (!att) throw new HttpProblem(404, "not-attested", "This tape has not been signed off yet.");
  const leaf = att.leaves.find((l) => l.loanId === loanId);
  if (!leaf) throw new HttpProblem(404, "loan-not-in-attestation", `${loanId} is not part of this attestation.`);
  const hashes = att.leaves.map((l) => l.hash);
  const proof = merkleProof(hashes, leaf.hash);
  return { loanId, leaf: leaf.hash, merkleRoot: att.merkleRoot, proof,
           valid: verifyMerkleProof(leaf.hash, proof, att.merkleRoot) };
}

/** full lineage for one loan: raw -> coercions -> rules -> proposals -> decisions -> hash */
export async function loanLineage(recordId: string) {
  const [rec] = await db.select({ rec: loanRecords, raw: rawRecords, file: sourceFiles })
    .from(loanRecords)
    .innerJoin(rawRecords, eq(rawRecords.id, loanRecords.rawRecordId))
    .innerJoin(sourceFiles, eq(sourceFiles.id, rawRecords.sourceFileId))
    .where(eq(loanRecords.id, recordId)).limit(1);
  if (!rec) throw new HttpProblem(404, "record-not-found", "That loan record does not exist.");

  const trans = await db.select().from(transformations)
    .where(eq(transformations.recordId, recordId)).orderBy(asc(transformations.createdAt));

  const excs = await db.select({ exc: exceptions, rule: rules })
    .from(exceptions).innerJoin(rules, eq(rules.id, exceptions.ruleId))
    .where(eq(exceptions.recordId, recordId));

  const props = excs.length
    ? await db.select({ p: proposals, d: decisions })
        .from(proposals).leftJoin(decisions, eq(decisions.proposalId, proposals.id))
        .where(inArray(proposals.exceptionId, excs.map((e) => e.exc.id)))
    : [];

  const events = await db.select().from(auditEvents)
    .where(inArray(auditEvents.entityId, [recordId, ...excs.map((e) => e.exc.id), ...props.map((p) => p.p.id)]))
    .orderBy(asc(auditEvents.seq));

  const [verified] = await db.select().from(verifiedRecords)
    .where(eq(verifiedRecords.loanRecordId, recordId)).limit(1);

  return { record: rec.rec, raw: rec.raw, file: rec.file, transformations: trans,
           exceptions: excs, proposals: props, events, verified };
}
