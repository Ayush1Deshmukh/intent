"use client";
import { useActionState, useState } from "react";
import { confirmMappingAction } from "@/app/actions";

type Row = {
  id: string; sourceHeader: string; canonicalField: string | null; method: string;
  confidence: number; samples: string[]; rationale: string | null; detected: string | null;
};

const METHOD_TONE: Record<string, string> = {
  EXACT: "sev-INFO", ALIAS: "sev-INFO", FUZZY: "sev-WARNING", AI: "sev-WARNING", MANUAL: "sev-INFO",
};
const METHOD_WHY: Record<string, string> = {
  EXACT: "the header is the canonical name",
  ALIAS: "matched a known header variant",
  FUZZY: "closest match by token and edit similarity",
  AI: "inferred from the shape of the values — confirm this one",
  MANUAL: "set by hand",
};

export default function MappingForm({ tapeId, rows, fields }: {
  tapeId: string;
  rows: Row[];
  fields: { value: string; label: string; required: boolean }[];
}) {
  const [state, action, pending] = useActionState(confirmMappingAction, null as { error?: string } | null);
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(rows.map((r) => [r.sourceHeader, r.canonicalField ?? ""])));

  const lowConfidence = rows.filter((r) => r.canonicalField && r.confidence < 0.9).length;

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="tapeId" value={tapeId} />

      <div className="card overflow-hidden">
        <table className="grid">
          <thead>
            <tr>
              <th>Source column</th><th>Sample values</th><th>Maps to</th>
              <th>How</th><th className="tnum">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const chosen = values[r.sourceHeader];
              return (
                <tr key={r.id}>
                  <td className="mono text-xs font-medium whitespace-nowrap">{r.sourceHeader || <em className="text-muted">(blank)</em>}</td>
                  <td className="text-muted text-xs max-w-[240px]">
                    <div className="flex flex-col gap-0.5">
                      {r.samples.slice(0, 3).map((s, i) => <span key={i} className="mono truncate">{s}</span>)}
                      {r.samples.length === 0 ? <span className="italic">all empty</span> : null}
                    </div>
                  </td>
                  <td className="min-w-[200px]">
                    <select name={`map:${r.sourceHeader}`} value={chosen}
                      onChange={(e) => setValues((v) => ({ ...v, [r.sourceHeader]: e.target.value }))}>
                      <option value="">— leave unmapped —</option>
                      {fields.map((f) => (
                        <option key={f.value} value={f.value}>{f.label}{f.required ? " *" : ""}</option>
                      ))}
                    </select>
                    {r.detected ? <span className="block mt-1 text-[0.68rem] text-brass mono">detected: {r.detected}</span> : null}
                  </td>
                  <td className="max-w-[220px]">
                    {chosen ? (
                      <>
                        <span className={`chip ${METHOD_TONE[r.method] ?? "sev-INFO"}`}>{r.method}</span>
                        <span className="block text-[0.68rem] text-muted mt-1">{r.rationale ?? METHOD_WHY[r.method]}</span>
                      </>
                    ) : (
                      <span className="text-[0.68rem] text-muted">{r.rationale ?? "carries no canonical equivalent"}</span>
                    )}
                  </td>
                  <td className="tnum">
                    {chosen ? (
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-14 rounded-full bg-surface2 overflow-hidden">
                          <div className="h-full" style={{
                            width: `${Math.round(r.confidence * 100)}%`,
                            background: r.confidence >= 0.9 ? "var(--color-ok)" : "var(--color-warn)",
                          }} />
                        </div>
                        <span className="mono text-xs">{r.confidence.toFixed(2)}</span>
                      </div>
                    ) : <span className="text-muted text-xs">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card p-4 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="eyebrow">Reporting date</span>
          <input name="asOf" type="date" defaultValue="2026-07-31" className="w-44" />
          <span className="text-[0.68rem] text-muted">staleness is measured against this date</span>
        </label>
        <div className="flex-1 text-sm text-ink2 min-w-[240px]">
          {lowConfidence > 0
            ? <>Confirm the <strong>{lowConfidence}</strong> low-confidence {lowConfidence === 1 ? "column" : "columns"} above before continuing.</>
            : <>Every mapped column matched at high confidence.</>}
        </div>
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "Normalizing and validating…" : "Confirm mapping and validate"}
        </button>
      </div>

      {state?.error ? <p className="text-crit text-sm">{state.error}</p> : null}
    </form>
  );
}
