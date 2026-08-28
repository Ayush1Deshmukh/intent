"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Subject } from "@/components/ui";

type Item = {
  id: string; field: string; from: string | null; to: string | null; rationale: string;
  confidence: number; source: string; model: string | null;
  evidence: { label: string; value: string }[] | null;
  loanId: string | null; rowNumber: number | null; tapeName: string; tapeId: string;
  ruleCode: string; ruleName: string; severity: string; acceptedBy: string; acceptedEmail: string;
};

export default function ReviewList({ items }: { items: Item[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function decide(id: string, action: "approve" | "reject") {
    setBusy(id + action);
    try {
      const res = await fetch(`/api/v1/proposals/${id}/decision`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, reason: reasons[id] ?? "" }),
      });
      const json = await res.json();
      if (!res.ok) setErrors((e) => ({ ...e, [id]: json.detail ?? "That did not work." }));
      else router.refresh();
    } finally { setBusy(null); }
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map((it) => (
        <article key={it.id} className="card p-5 flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex flex-col gap-1">
              <span className="flex items-center gap-2">
                <Subject loanId={it.loanId} rowNumber={it.rowNumber} className="text-sm font-medium" />
                <span className={`chip sev-${it.severity}`}>{it.severity.toLowerCase()}</span>
                <span className="chip bg-surface2 text-muted">{it.ruleCode}</span>
              </span>
              <span className="text-sm">{it.ruleName}</span>
              <Link href={`/tapes/${it.tapeId}`} className="text-xs text-muted">{it.tapeName}</Link>
            </div>
            <div className="text-right text-xs text-muted leading-relaxed">
              accepted by <strong className="text-ink">{it.acceptedBy}</strong>
              <span className="block mono text-[0.62rem]">{it.acceptedEmail}</span>
              <span className="chip bg-surface2 text-muted mt-1">
                {it.source === "RULE" ? "rule-based" : it.source === "HUMAN" ? "by hand" : `model · ${it.model}`} · {it.confidence.toFixed(2)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <span className="mono text-xs text-muted w-28">{it.field}</span>
            <span className="mono text-sm px-2.5 py-1.5 rounded bg-critsoft text-crit line-through">{it.from ?? "empty"}</span>
            <span className="text-muted">→</span>
            <span className="mono text-sm px-2.5 py-1.5 rounded bg-oksoft text-ok">{it.to ?? "empty"}</span>
          </div>

          <p className="text-sm text-ink2 leading-relaxed max-w-3xl">{it.rationale}</p>

          {it.evidence?.length ? (
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              {it.evidence.map((e, i) => (
                <span key={i} className="text-xs"><span className="text-muted">{e.label}:</span> <span className="mono">{e.value}</span></span>
              ))}
            </div>
          ) : null}

          <div className="flex items-end gap-3 flex-wrap">
            <label className="flex flex-col gap-1 flex-1 min-w-[260px]">
              <span className="eyebrow">Reason (required to reject)</span>
              <input value={reasons[it.id] ?? ""} onChange={(e) => setReasons((r) => ({ ...r, [it.id]: e.target.value }))}
                placeholder="Checked against the note" />
            </label>
            <button className="btn btn-primary" disabled={busy !== null} onClick={() => decide(it.id, "approve")}>
              {busy === it.id + "approve" ? "Applying…" : "Approve and apply"}
            </button>
            <button className="btn btn-danger" disabled={busy !== null || (reasons[it.id] ?? "").trim().length < 4}
              onClick={() => decide(it.id, "reject")}>Reject</button>
          </div>

          {errors[it.id] ? <p className="text-crit text-sm">{errors[it.id]}</p> : null}
        </article>
      ))}
    </div>
  );
}
