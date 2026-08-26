import { desc, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db, tapes, idempotency } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { HttpProblem, problemHandler } from "@/lib/problem";
import { ingestFiles } from "@/lib/service/ingest";
import { SourceKind } from "@/lib/ingest/pipeline";

export const GET = problemHandler(async () => {
  await requireRole("tape:read");
  return Response.json({ items: await db.select().from(tapes).orderBy(desc(tapes.createdAt)) });
});

/** multipart upload. Honours Idempotency-Key — re-uploading is the likeliest judge accident. */
export const POST = problemHandler(async (req) => {
  const session = await requireRole("tape:upload");
  const form = await req.formData();

  const kinds: SourceKind[] = ["LOAN_TAPE", "SERVICER_UPDATE", "DOCUMENT_MANIFEST"];
  const files: { kind: SourceKind; filename: string; buffer: Buffer }[] = [];
  for (const k of kinds) {
    const f = form.get(k) ?? (k === "LOAN_TAPE" ? form.get("file") : null);
    if (f instanceof File && f.size > 0) {
      files.push({ kind: k, filename: f.name, buffer: Buffer.from(await f.arrayBuffer()) });
    }
  }
  if (!files.length) throw new HttpProblem(400, "no-files", "Attach a loan tape as `file` or `LOAN_TAPE`.");

  const fingerprint = createHash("sha256")
    .update(files.map((f) => f.filename + ":" + createHash("sha256").update(f.buffer).digest("hex")).join("|"))
    .digest("hex");

  const key = req.headers.get("idempotency-key");
  if (key) {
    const [seen] = await db.select().from(idempotency).where(eq(idempotency.key, key)).limit(1);
    if (seen) {
      if (seen.fingerprint !== fingerprint) {
        throw new HttpProblem(409, "idempotency-key-reused",
          "That Idempotency-Key was already used for a different set of files.");
      }
      return Response.json(seen.response, { status: 202, headers: { "idempotent-replay": "true" } });
    }
  }

  const res = await ingestFiles(session, String(form.get("name") || files[0].filename), files,
    Number(process.env.MAX_TAPE_ROWS ?? 5000));

  const body = { tapeId: res.tapeId, rowCount: res.rowCount, sha256: res.sha256,
    mappings: res.matches.map((m) => ({ header: m.sourceHeader, field: m.canonicalField, method: m.method, confidence: m.confidence })) };

  if (key) await db.insert(idempotency).values({ key, fingerprint, response: body }).onConflictDoNothing();
  return Response.json(body, { status: 202 });
});
