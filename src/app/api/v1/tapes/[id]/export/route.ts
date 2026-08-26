import JSZip from "jszip";
import { asc, eq } from "drizzle-orm";
import {
  db, tapes, loanRecords, exceptions, rules, auditEvents, attestations, verifiedRecords, sourceFiles,
} from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { HttpProblem, problemHandler } from "@/lib/problem";
import { verifyTape } from "@/lib/service/attest";
import { CANONICAL_FIELDS } from "@/lib/schema/fields";
import { emit } from "@/lib/audit";

const csv = (rows: (string | number | null)[][]) =>
  rows.map((r) => r.map((c) => {
    const s = c === null || c === undefined ? "" : String(c);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\n") + "\n";

/**
 * The audit bundle: everything a downstream consumer or an external auditor needs
 * to check this tape without access to the running system.
 */
export const GET = problemHandler(async (_req, ctx: unknown) => {
  const session = await requireRole("export:generate");
  const { params } = ctx as unknown as { params: Promise<{ id: string }> };
  const { id } = await params;

  const [tape] = await db.select().from(tapes).where(eq(tapes.id, id)).limit(1);
  if (!tape) throw new HttpProblem(404, "tape-not-found", "That tape does not exist.");

  const [records, excs, events, files, verified, verification] = await Promise.all([
    db.select().from(loanRecords).where(eq(loanRecords.tapeId, id)).orderBy(asc(loanRecords.loanId)),
    db.select({ e: exceptions, r: rules }).from(exceptions)
      .innerJoin(rules, eq(rules.id, exceptions.ruleId)).where(eq(exceptions.tapeId, id)),
    db.select().from(auditEvents).where(eq(auditEvents.tapeId, id)).orderBy(asc(auditEvents.seq)),
    db.select().from(sourceFiles).where(eq(sourceFiles.tapeId, id)),
    db.select().from(verifiedRecords).where(eq(verifiedRecords.tapeId, id)),
    verifyTape(id),
  ]);
  const [att] = await db.select().from(attestations).where(eq(attestations.tapeId, id)).limit(1);

  const zip = new JSZip();

  zip.file("clean.csv", csv([
    [...CANONICAL_FIELDS, "verificationStatus", "version", "recordHash"],
    ...records.map((r) => [
      ...CANONICAL_FIELDS.map((f) => {
        const v = (r as unknown as Record<string, unknown>)[f];
        return v instanceof Date ? v.toISOString() : (v as string | number | null);
      }),
      r.verificationStatus, r.version, r.recordHash,
    ]),
  ]));

  zip.file("exceptions.csv", csv([
    ["ruleCode", "ruleName", "severity", "status", "loanRecordId", "field", "observed", "expected", "clusterKey"],
    ...excs.map((x) => [
      x.r.code, x.r.name, x.e.severity, x.e.status, x.e.recordId, x.e.field,
      x.e.observed, x.e.expected, x.e.clusterKey,
    ]),
  ]));

  zip.file("audit.jsonl", events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  zip.file("attestation.json", JSON.stringify(att ?? { attested: false }, null, 2));
  zip.file("verified_records.json", JSON.stringify(verified, null, 2));
  zip.file("sources.json", JSON.stringify(files.map((f) => ({
    kind: f.kind, filename: f.filename, sha256: f.sha256, rowCount: f.rowCount, headers: f.headers,
  })), null, 2));

  zip.file("VERIFY.md", [
    `# Verifying ${tape.name} without this system`,
    "",
    `Exported ${new Date().toISOString()} by ${session.email}.`,
    "",
    "## 1. The event chain",
    "",
    "`audit.jsonl` is ordered by `seq`. For each event compute",
    "",
    "    hash = sha256( prevHash + \"|\" + canonicalJson({seq, createdAt, actorId, actorRole,",
    "                                                   action, entityType, entityId, payload}) )",
    "",
    "where the first event's `prevHash` is 64 zeros. Canonical JSON means: object keys sorted",
    "lexicographically and recursively, `null` emitted explicitly, no whitespace. Every computed",
    "hash must equal the stored `hash`, and each event's `prevHash` must equal the previous",
    "event's `hash`. A gap in `seq` means an event was deleted.",
    "",
    "## 2. The data",
    "",
    "`attestation.json` carries the signed Merkle root and one leaf per sealed record.",
    "Re-hash each record in `clean.csv` over its 19 business fields — money at 2 decimal places,",
    "rates at 4, dates as `YYYY-MM-DD` — sort the leaf hashes ascending as hex, and combine",
    "pairwise with `sha256(left + right)`, promoting any odd node unchanged. The result must",
    "equal `merkleRoot`.",
    "",
    "## 3. This export's own result",
    "",
    "```json",
    JSON.stringify(verification, null, 2),
    "```",
    "",
    `Chain: ${verification.chain.ok ? `intact over ${verification.chain.eventsChecked} events` : `BROKEN at event ${verification.chain.firstBadSeq}`}`,
    `Data: ${verification.data.ok ? "matches the attested root" : "DIVERGES from the attested root"}`,
    "",
  ].join("\n"));

  const buf = await zip.generateAsync({ type: "nodebuffer" });

  await db.transaction(async (tx) => {
    await emit(tx, {
      tapeId: id, actorId: session.userId, actorRole: session.role,
      action: "EXPORT_GENERATED", entityType: "tape", entityId: id,
      payload: { records: records.length, exceptions: excs.length, events: events.length, bytes: buf.length },
    });
  });

  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="verified-tape-${id}.zip"`,
    },
  });
});
