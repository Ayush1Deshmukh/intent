"use client";
import { useState } from "react";

type Result = {
  ok: boolean; attested: boolean;
  chain: { ok: boolean; eventsChecked: number; firstBadSeq: number | null; reason: string | null };
  data: { ok: boolean; attestedRoot: string | null; recomputedRoot: string | null; recordCount: number;
          divergences: { loanId: string; attestedHash: string; recomputedHash: string; reason: string }[] };
  checkedAt: string;
};

export default function IntegrityPanel({ tapeId, attested, merkleRoot, recordCount, signer }: {
  tapeId: string; attested: boolean; merkleRoot: string | null; recordCount: number; signer: string | null;
}) {
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  async function check() {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/verify/${tapeId}`, { cache: "no-store" });
      setResult(await res.json());
    } finally { setBusy(false); }
  }

  return (
    <section className="card p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Integrity</h2>
        <button className="btn btn-sm" onClick={check} disabled={busy}>
          {busy ? "Recomputing…" : "Check integrity"}
        </button>
      </div>

      {attested ? (
        <dl className="flex flex-col gap-2 text-xs">
          <div className="flex justify-between gap-3"><dt className="text-muted">Merkle root</dt>
            <dd className="mono truncate max-w-[60%]" title={merkleRoot ?? ""}>{merkleRoot?.slice(0, 28)}…</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted">Records sealed</dt><dd className="mono tnum">{recordCount}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted">Signed by</dt><dd className="mono truncate">{signer}</dd></div>
        </dl>
      ) : (
        <p className="text-sm text-ink2">
          This tape has not been signed off, so there is no attested root to compare against yet.
          The audit chain can still be verified.
        </p>
      )}

      {result ? (
        <div className="flex flex-col gap-3">
          <div className={`p-3 rounded-lg text-sm ${result.ok ? "bg-oksoft text-ok" : "bg-critsoft text-crit"}`}>
            <strong>{result.ok ? "Verified." : "Verification failed."}</strong>{" "}
            {result.ok
              ? `${result.chain.eventsChecked} events form an unbroken chain, and all ${result.data.recordCount} sealed records still match the attested root.`
              : result.chain.ok
                ? "The audit chain is intact, but the stored data no longer matches what was signed off."
                : result.chain.reason}
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            <dt className="text-muted">Chain</dt>
            <dd className={result.chain.ok ? "text-ok" : "text-crit"}>
              {result.chain.ok ? `intact over ${result.chain.eventsChecked} events` : `broken at event ${result.chain.firstBadSeq}`}
            </dd>
            <dt className="text-muted">Attested root</dt>
            <dd className="mono truncate">{result.data.attestedRoot?.slice(0, 32) ?? "—"}…</dd>
            <dt className="text-muted">Recomputed</dt>
            <dd className={`mono truncate ${result.data.ok ? "" : "text-crit"}`}>{result.data.recomputedRoot?.slice(0, 32) ?? "—"}…</dd>
          </dl>

          {result.data.divergences.length ? (
            <div className="flex flex-col gap-1.5">
              <span className="eyebrow text-crit">Divergent records</span>
              {result.data.divergences.slice(0, 6).map((d) => (
                <div key={d.loanId} className="text-xs border-l-2 border-crit pl-2.5">
                  <span className="mono font-medium">{d.loanId}</span> — {d.reason}
                  <div className="mono text-[0.62rem] text-muted mt-0.5">
                    attested {d.attestedHash.slice(0, 16)}… → now {d.recomputedHash.slice(0, 16)}…
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <p className="text-[0.68rem] text-muted">
            Recomputed from the live rows at {new Date(result.checkedAt).toLocaleTimeString()} — never from the stored hash.
            This endpoint is public: anyone can check a tape, nobody can change it.
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted">
          Recomputes the whole event chain from genesis and re-hashes every sealed record.
          A direct database edit — the one thing an audit log cannot see — shows up here.
        </p>
      )}
    </section>
  );
}
