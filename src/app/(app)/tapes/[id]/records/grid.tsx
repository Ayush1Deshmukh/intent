"use client";
import { useState } from "react";

type Row = Record<string, string | number | null> & { id: string; recordHash: string; status: string; version: number };

type Lineage = {
  record: Record<string, unknown>;
  raw: { rowNumber: number; original: Record<string, string>; rowHash: string };
  file: { filename: string; sha256: string };
  transformations: { field: string; before: string | null; after: string | null; coercion: string }[];
  exceptions: { exc: { id: string; field: string | null; observed: string | null; severity: string; status: string };
                rule: { code: string; name: string } }[];
  proposals: { p: { id: string; field: string; fromValue: string | null; toValue: string | null;
                    rationale: string; confidence: number; source: string; status: string };
               d: { action: string; actorRole: string; reason: string | null } | null }[];
  events: { seq: number; action: string; createdAt: string }[];
  verified?: { recordHash: string; eventSeq: number; verifiedByEmail: string } | null;
};

const COLS = ["loanId","borrowerId","originationDate","maturityDate","originalPrincipal","currentBalance","interestRate","termMonths","paymentStatus","daysPastDue","borrowerState","creditScore","documentStatus"];

export default function RecordGrid({ rows }: { rows: Row[] }) {
  const [q, setQ] = useState("");
  const [lineage, setLineage] = useState<Lineage | null>(null);
  const [loading, setLoading] = useState(false);

  const filtered = q
    ? rows.filter((r) => Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(q.toLowerCase())))
    : rows;

  async function open(id: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/records/${id}/lineage`);
      setLineage(await res.json());
    } finally { setLoading(false); }
  }

  return (
    <div className="flex flex-col gap-3">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by loan id, state, status…" className="max-w-sm" />
      <div className="card overflow-hidden">
        <div className="max-h-[70vh] overflow-auto">
          <table className="grid">
            <thead><tr>{COLS.map((c) => <th key={c}>{c}</th>)}<th>Status</th><th>Hash</th></tr></thead>
            <tbody>
              {filtered.slice(0, 400).map((r) => (
                <tr key={r.id} className="cursor-pointer" onClick={() => open(r.id)}>
                  {COLS.map((c) => (
                    <td key={c} className={`${/Principal|Balance|Rate|Months|Score|daysPastDue/.test(c) ? "tnum text-right mono text-xs" : "text-xs"} whitespace-nowrap`}>
                      {r[c] ?? <span className="text-muted">—</span>}
                    </td>
                  ))}
                  <td><span className={`chip ${r.status === "VERIFIED" ? "bg-oksoft text-ok" : r.status === "EXCEPTION" ? "bg-critsoft text-crit" : "bg-surface2 text-muted"}`}>{r.status.toLowerCase()}</span></td>
                  <td className="mono text-[0.62rem] text-muted">v{r.version} {r.recordHash.slice(0, 8)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {loading ? <p className="text-sm text-muted">Loading lineage…</p> : null}

      {lineage ? (
        <div className="fixed inset-0 z-30 flex justify-end bg-black/25" onClick={() => setLineage(null)}>
          <aside className="w-full max-w-2xl h-full bg-surface border-l border-line overflow-auto p-6 flex flex-col gap-5"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <span className="eyebrow">Lineage</span>
                <h2 className="text-lg font-semibold mono">{String(lineage.record.loanId ?? "—")}</h2>
              </div>
              <button className="btn btn-sm" onClick={() => setLineage(null)}>Close</button>
            </div>

            <Section title="Raw, as it arrived">
              <p className="text-xs text-muted mb-2">
                {lineage.file.filename} · row {lineage.raw.rowNumber} · file sha256 {lineage.file.sha256.slice(0, 16)}…
              </p>
              <div className="grid grid-cols-[minmax(90px,auto)_1fr] gap-x-3 gap-y-1 text-xs">
                {Object.entries(lineage.raw.original).map(([k, v]) => (
                  <div key={k} className="contents"><span className="text-muted mono">{k}</span><span className="mono break-all">{v || <em className="text-muted">empty</em>}</span></div>
                ))}
              </div>
            </Section>

            <Section title={`Coercions (${lineage.transformations.length})`}>
              {lineage.transformations.length === 0 ? <p className="text-xs text-muted">Nothing needed changing.</p> : (
                <div className="flex flex-col gap-1.5">
                  {lineage.transformations.map((t, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs flex-wrap">
                      <span className="mono text-muted w-32 shrink-0">{t.field}</span>
                      <span className="mono px-1.5 py-0.5 rounded bg-surface2">{t.before || "empty"}</span>
                      <span className="text-muted">→</span>
                      <span className="mono px-1.5 py-0.5 rounded bg-oksoft text-ok">{t.after || "empty"}</span>
                      <span className="chip bg-brasssoft text-brass">{t.coercion}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section title={`Rules that fired (${lineage.exceptions.length})`}>
              {lineage.exceptions.length === 0 ? <p className="text-xs text-muted">This record passed every rule.</p> : (
                <div className="flex flex-col gap-1.5">
                  {lineage.exceptions.map((e) => (
                    <div key={e.exc.id} className="flex items-center gap-2 text-xs flex-wrap">
                      <span className={`chip sev-${e.exc.severity}`}>{e.exc.severity.toLowerCase()}</span>
                      <span className="mono text-muted">{e.rule.code}</span>
                      <span>{e.rule.name}</span>
                      <span className="chip bg-surface2 text-muted">{e.exc.status.toLowerCase().replace("_", " ")}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {lineage.proposals.length ? (
              <Section title={`Proposals and decisions (${lineage.proposals.length})`}>
                <div className="flex flex-col gap-2">
                  {lineage.proposals.map(({ p, d }) => (
                    <div key={p.id + (d?.action ?? "")} className="border-l-2 border-accent pl-2.5 text-xs flex flex-col gap-1">
                      <span className="flex items-center gap-2 flex-wrap">
                        <span className="mono text-muted">{p.field}</span>
                        <span className="mono px-1.5 py-0.5 rounded bg-critsoft text-crit">{p.fromValue ?? "empty"}</span>
                        <span>→</span>
                        <span className="mono px-1.5 py-0.5 rounded bg-oksoft text-ok">{p.toValue ?? "empty"}</span>
                        <span className="chip bg-surface2 text-muted">{p.source.toLowerCase()} · {p.confidence.toFixed(2)}</span>
                        <span className="chip bg-surface2 text-muted">{p.status.toLowerCase().replace(/_/g, " ")}</span>
                      </span>
                      <span className="text-ink2">{p.rationale}</span>
                      {d ? <span className="text-muted">{d.action} by {d.actorRole.toLowerCase().replace(/_/g, " ")}{d.reason ? ` — "${d.reason}"` : ""}</span> : null}
                    </div>
                  ))}
                </div>
              </Section>
            ) : null}

            <Section title="Hash">
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <span className="text-muted">row hash</span><span className="mono break-all">{lineage.raw.rowHash}</span>
                <span className="text-muted">record hash</span><span className="mono break-all">{String(lineage.record.recordHash)}</span>
                <span className="text-muted">version</span><span className="mono">{String(lineage.record.version)}</span>
                {lineage.verified ? (
                  <>
                    <span className="text-muted">sealed at</span><span className="mono">event #{lineage.verified.eventSeq}</span>
                    <span className="text-muted">signed by</span><span className="mono">{lineage.verified.verifiedByEmail}</span>
                  </>
                ) : null}
              </div>
            </Section>

            <Section title={`Audit events (${lineage.events.length})`}>
              <div className="flex flex-col gap-0.5 text-xs">
                {lineage.events.map((e) => (
                  <span key={e.seq} className="flex gap-2">
                    <span className="mono text-muted w-12 text-right">#{e.seq}</span>
                    <span className="mono">{e.action.toLowerCase().replace(/_/g, " ")}</span>
                  </span>
                ))}
              </div>
            </Section>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-4 flex flex-col gap-2">
      <span className="eyebrow">{title}</span>
      {children}
    </section>
  );
}
