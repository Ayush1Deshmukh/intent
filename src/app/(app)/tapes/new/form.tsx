"use client";
import { useActionState } from "react";
import { uploadAction } from "@/app/actions";

const SLOTS = [
  { key: "LOAN_TAPE", label: "Loan tape", required: true,
    hint: "The primary file. CSV or Excel. One row per loan." },
  { key: "SERVICER_UPDATE", label: "Servicer update", required: false,
    hint: "A later servicing extract. Where it disagrees with the tape, an exception is raised." },
  { key: "DOCUMENT_MANIFEST", label: "Document manifest", required: false,
    hint: "Which loans have a note and a security instrument on file." },
];

export default function UploadForm() {
  const [state, action, pending] = useActionState(uploadAction, null as { error?: string } | null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="card p-4 flex flex-col gap-2">
        <span className="eyebrow">Batch name</span>
        <input name="name" placeholder="Q3 2026 acquisition tape" />
      </label>

      {SLOTS.map((s) => (
        <label key={s.key} className="card p-4 flex flex-col gap-2">
          <span className="flex items-center gap-2">
            <span className="eyebrow">{s.label}</span>
            {s.required ? <span className="chip sev-CRITICAL">required</span> : <span className="chip sev-INFO">optional</span>}
          </span>
          <span className="text-xs text-muted">{s.hint}</span>
          <input type="file" name={s.key} accept=".csv,.tsv,.xlsx,.xls" required={s.required} />
        </label>
      ))}

      {state?.error ? <p className="text-crit text-sm">{state.error}</p> : null}
      <div>
        <button className="btn btn-primary" disabled={pending}>{pending ? "Reading files…" : "Ingest and propose a mapping"}</button>
      </div>
    </form>
  );
}
