"use client";
import { useEffect, useState } from "react";

type Result = {
  ok: boolean; attested: boolean;
  chain: { ok: boolean; eventsChecked: number; firstBadSeq: number | null; reason: string | null };
  data: { ok: boolean; attestedRoot: string | null; recomputedRoot: string | null; recordCount: number;
          divergences: { loanId: string; attestedHash: string; recomputedHash: string; reason: string }[] };
  checkedAt: string;
};

/**
 * The last thirty seconds of the demo lives in this panel, so it is worth two things
 * a plain button does not give you.
 *
 * First, the check has to *look* like work being done — it recomputes an entire event
 * chain from genesis and re-hashes every sealed record, and if that returns
 * instantly with a green tick nobody believes it happened. The two-stage readout is
 * the real sequence, held briefly so it can be read.
 *
 * Second, the failure state has to be unmistakable across a room. Green and red at
 * chip size is not enough when the whole argument of the product is riding on it.
 */
export default function IntegrityPanel({ tapeId, attested, merkleRoot, recordCount, signer }: {
  tapeId: string; attested: boolean; merkleRoot: string | null; recordCount: number; signer: string | null;
}) {
  const [result, setResult] = useState<Result | null>(null);
  const [stage, setStage] = useState<null | "chain" | "data">(null);

  const busy = stage !== null;

  useEffect(() => {
    if (stage !== "chain") return;
    const t = setTimeout(() => setStage("data"), 700);
    return () => clearTimeout(t);
  }, [stage]);

  async function check() {
    setResult(null);
    setStage("chain");
    const started = Date.now();
    try {
      const res = await fetch(`/api/v1/verify/${tapeId}`, { cache: "no-store" });
      const json = await res.json();
      // hold long enough that both stages are legible; the check itself is fast
      const held = Math.max(0, 1500 - (Date.now() - started));
      setTimeout(() => { setResult(json); setStage(null); }, held);
    } catch {
      setStage(null);
    }
  }

  return (
    <section className="card p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Integrity</h2>
        <button className="btn btn-sm" onClick={check} disabled={busy}>
          {busy ? "Recomputing…" : result ? "Check again" : "Check integrity"}
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

      {busy ? (
        <div className="flex flex-col gap-3 fadein" role="status" aria-live="polite">
          <Step active={stage === "chain"} done={stage === "data"}
            label="Replaying the event chain from genesis"
            detail="every event re-hashed against the one before it" />
          <Step active={stage === "data"} done={false}
            label="Re-hashing every sealed record"
            detail="from the live rows — never from the stored hash" />
          <div className="h-1 w-full rounded-full bg-surface2 overflow-hidden">
            <div className="h-full shimmer w-full" />
          </div>
        </div>
      ) : null}

      {result && !busy ? (
        <div className="flex flex-col gap-3 rise">
          <div className={`p-3.5 rounded-lg text-sm flex items-start gap-3
            ${result.ok ? "bg-oksoft text-ok" : "bg-critsoft text-crit"}`}>
            <span className={`mt-0.5 h-5 w-5 shrink-0 rounded-full flex items-center justify-center pop
              ${result.ok ? "bg-ok" : "bg-crit"}`} aria-hidden>
              <svg viewBox="0 0 14 14" className="h-3 w-3">
                {result.ok
                  ? <path d="M2.5 7.4 L5.6 10.5 L11.5 3.9" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
                  : <path d="M4 4 L10 10 M10 4 L4 10" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" />}
              </svg>
            </span>
            <span>
              <strong>{result.ok ? "Verified." : "Verification failed."}</strong>{" "}
              {result.ok
                ? `${result.chain.eventsChecked} events form an unbroken chain, and all ${result.data.recordCount} sealed records still match the attested root.`
                : result.chain.ok
                  ? "The audit chain is intact, but the stored data no longer matches what was signed off."
                  : result.chain.reason}
            </span>
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            <dt className="text-muted">Chain</dt>
            <dd className={result.chain.ok ? "text-ok" : "text-crit"}>
              {result.chain.ok ? `intact over ${result.chain.eventsChecked} events` : `broken at event ${result.chain.firstBadSeq}`}
            </dd>
            <dt className="text-muted">Attested root</dt>
            <dd className="mono truncate">{result.data.attestedRoot?.slice(0, 32) ?? "—"}…</dd>
            <dt className="text-muted">Recomputed</dt>
            <dd className={`mono truncate ${result.data.ok ? "" : "text-crit font-medium"}`}>
              {result.data.recomputedRoot?.slice(0, 32) ?? "—"}…
            </dd>
          </dl>

          {result.data.divergences.length ? (
            <div className="flex flex-col gap-1.5">
              <span className="eyebrow text-crit">Divergent records</span>
              {result.data.divergences.slice(0, 6).map((d, i) => (
                <div key={d.loanId} className="text-xs border-l-2 border-crit pl-2.5 rise"
                  style={{ animationDelay: `${0.06 * i}s` }}>
                  <span className="mono font-medium">{d.loanId}</span> — {d.reason}
                  <div className="mono text-[0.62rem] text-muted mt-0.5">
                    attested {d.attestedHash.slice(0, 16)}… → now {d.recomputedHash.slice(0, 16)}…
                  </div>
                </div>
              ))}
              {result.chain.ok ? (
                <p className="text-[0.7rem] text-ink2 mt-1 leading-relaxed">
                  Note that the chain is still <strong>intact</strong>. Nothing was logged, because the
                  application was never involved — an audit log on its own would have reported this
                  tape as fine.
                </p>
              ) : null}
            </div>
          ) : null}

          <p className="text-[0.68rem] text-muted">
            Recomputed from the live rows at {new Date(result.checkedAt).toLocaleTimeString()} — never from the stored hash.
            This endpoint is public: anyone can check a tape, nobody can change it.
          </p>
        </div>
      ) : null}

      {!result && !busy ? (
        <p className="text-xs text-muted">
          Recomputes the whole event chain from genesis and re-hashes every sealed record.
          A direct database edit — the one thing an audit log cannot see — shows up here.
        </p>
      ) : null}
    </section>
  );
}

function Step({ active, done, label, detail }: {
  active: boolean; done: boolean; label: string; detail: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border flex items-center justify-center
        ${done ? "bg-ok border-ok" : active ? "border-accent" : "border-line2"}`}>
        {done ? (
          <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" aria-hidden>
            <path d="M2 6.4 L4.6 9 L10 3.2" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : active ? <span className="h-1.5 w-1.5 rounded-full bg-accent livepulse" /> : null}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className={`text-sm leading-tight ${active || done ? "text-ink" : "text-muted"}`}>{label}</span>
        <span className="text-[0.7rem] text-muted leading-snug">{detail}</span>
      </span>
    </div>
  );
}
