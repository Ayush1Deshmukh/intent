import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db, fieldMappings, sourceFiles, rawRecords, tapes } from "@/lib/db";
import { requireRolePage } from "@/lib/auth";
import { CANONICAL_FIELDS, CanonicalField, FIELD_META } from "@/lib/schema/fields";
import { detectColumnHints } from "@/lib/coerce";
import MappingForm from "./form";

export const dynamic = "force-dynamic";

export default async function MappingPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRolePage("tape:map");
  const { id } = await params;

  const [tape] = await db.select().from(tapes).where(eq(tapes.id, id)).limit(1);
  const rows = await db.select().from(fieldMappings)
    .where(and(eq(fieldMappings.tapeId, id), eq(fieldMappings.sourceKind, "LOAN_TAPE")));
  const files = await db.select().from(sourceFiles).where(eq(sourceFiles.tapeId, id));
  const primary = files.find((f) => f.kind === "LOAN_TAPE");
  // A tape id that does not exist, or one whose loan tape never landed, is a 404 —
  // not a crash. Reaching for `!` here was the one place a bad URL took the page down.
  if (!tape || !primary) notFound();

  const sample = await db.select({ original: rawRecords.original }).from(rawRecords)
    .where(eq(rawRecords.sourceFileId, primary.id)).orderBy(asc(rawRecords.rowNumber)).limit(200);

  const map = new Map<string, CanonicalField>();
  for (const r of rows) if (r.canonicalField) map.set(r.sourceHeader, r.canonicalField as CanonicalField);
  const hints = detectColumnHints(sample.map((s) => s.original as Record<string, string>), map);

  const ordered = (primary.headers as string[]).map((h) => rows.find((r) => r.sourceHeader === h)!).filter(Boolean);
  const mapped = ordered.filter((r) => r.canonicalField).length;
  const missingRequired = CANONICAL_FIELDS.filter(
    (f) => FIELD_META[f].required && !ordered.some((r) => r.canonicalField === f));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/tapes" className="eyebrow no-underline">← Tapes</Link>
        <h1 className="text-2xl font-semibold">{tape.name}</h1>
        <p className="text-sm text-ink2">
          <strong>{mapped} of {ordered.length}</strong> columns matched automatically.
          Nothing is normalized until you confirm this mapping — the raw file stays exactly as it arrived either way.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {files.map((f) => (
          <div key={f.id} className="card p-4 flex flex-col gap-1">
            <span className="eyebrow">{f.kind.replace(/_/g, " ").toLowerCase()}</span>
            <span className="text-sm font-medium truncate" title={f.filename}>{f.filename}</span>
            <span className="text-xs text-muted tnum">{f.rowCount} rows · {(f.headers as string[]).length} columns</span>
            <span className="mono text-[0.62rem] text-muted truncate" title={f.sha256}>sha256 {f.sha256.slice(0, 24)}…</span>
          </div>
        ))}
      </div>

      {missingRequired.length ? (
        <div className="card p-4 border-crit bg-critsoft text-sm text-crit">
          <strong>Required fields not yet mapped:</strong>{" "}
          {missingRequired.map((f) => FIELD_META[f].label).join(", ")}. Validation will flag every row until they are.
        </div>
      ) : null}

      <MappingForm
        tapeId={id}
        rows={ordered.map((r) => ({
          id: r.id, sourceHeader: r.sourceHeader, canonicalField: r.canonicalField,
          method: r.method, confidence: r.confidence, samples: r.samples as string[],
          rationale: r.rationale,
          detected: r.canonicalField && hints[r.canonicalField as CanonicalField]
            ? JSON.stringify(hints[r.canonicalField as CanonicalField]).replace(/[{}"]/g, "").replace(/:/g, " ")
            : null,
        }))}
        fields={CANONICAL_FIELDS.map((f) => ({ value: f, label: FIELD_META[f].label, required: FIELD_META[f].required }))}
        rowCount={files.find((f) => f.kind === "LOAN_TAPE")?.rowCount ?? files[0]?.rowCount ?? 0}
      />
    </div>
  );
}
