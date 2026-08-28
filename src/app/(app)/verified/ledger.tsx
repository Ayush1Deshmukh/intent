"use client";
import { useMemo, useState } from "react";
import Link from "next/link";

export type LedgerRow = {
  id: string; loanId: string; tape: string; tapeId: string;
  balance: string | null; rate: string | null; status: string | null;
  signedBy: string; recordHash: string;
};

export default function Ledger({ rows, capped }: { rows: LedgerRow[]; capped: boolean }) {
  const [q, setQ] = useState("");
  const [tape, setTape] = useState("");

  const tapeNames = useMemo(
    () => [...new Map(rows.map((r) => [r.tapeId, r.tape])).entries()], [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) =>
      (!tape || r.tapeId === tape) &&
      (!needle || r.loanId.toLowerCase().includes(needle) ||
        r.recordHash.startsWith(needle) || (r.status ?? "").toLowerCase().includes(needle)));
  }, [rows, q, tape]);

  return (
    <div className="flex flex-col gap-3">
      <div className="card p-3 flex flex-wrap items-center gap-x-5 gap-y-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs"
          placeholder="Loan id, status, or the start of a hash…" />
        {tapeNames.length > 1 ? (
          <label className="flex items-center gap-2">
            <span className="eyebrow">Tape</span>
            <select value={tape} onChange={(e) => setTape(e.target.value)} className="max-w-[16rem]">
              <option value="">all</option>
              {tapeNames.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
        ) : null}
        <span className="mono text-xs text-muted tnum ml-auto">
          {filtered.length === rows.length ? `${rows.length} sealed` : `${filtered.length} of ${rows.length}`}
        </span>
      </div>

      <div className="card overflow-hidden">
        <div className="max-h-[70vh] overflow-auto">
          <table className="dtable">
            <thead>
              <tr><th>Loan</th><th>Tape</th><th>Balance</th><th>Rate</th><th>Status</th><th>Signed by</th><th>Record hash</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td className="mono text-xs font-medium">{r.loanId}</td>
                  <td className="text-xs"><Link href={`/tapes/${r.tapeId}`}>{r.tape}</Link></td>
                  <td className="tnum mono text-xs text-right">{r.balance ?? "—"}</td>
                  <td className="tnum mono text-xs text-right">{r.rate ?? "—"}</td>
                  <td className="text-xs">{r.status ?? "—"}</td>
                  <td className="text-xs text-muted">{r.signedBy}</td>
                  <td className="mono text-[0.62rem] text-muted" title={r.recordHash}>{r.recordHash.slice(0, 14)}…</td>
                  <td>
                    <a className="text-xs" href={`/api/v1/verified/${r.tapeId}?loanId=${r.loanId}`} target="_blank" rel="noreferrer">proof</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted">Nothing matches that. Clear the filter to see all {rows.length}.</p>
      ) : null}

      {capped ? (
        <p className="text-xs text-muted">
          Showing the most recently sealed 400 records. The full ledger is in the export bundle,
          and <span className="mono">GET /api/v1/verified/{"{tapeId}"}</span> returns any single loan
          with its Merkle proof.
        </p>
      ) : null}
    </div>
  );
}
