import Link from "next/link";
import { Stat } from "@/components/ui";

/**
 * What a Data Consumer opens this page to find out: how much of the portfolio is
 * trustworthy, and when that was last established.
 *
 * The quality score is deliberately just clean rows over total rows. A weighted
 * composite would look more sophisticated and say less — it hides which rules failed,
 * and a consumer deciding whether to use this data needs the severity breakdown, not a
 * number that has already made the judgement for them.
 */
export default function VerifiedSummary({ quality, sealed, attestations, exceptions, history }: {
  quality: { score: number | null; cleanRows: number; rowsWithExceptions: number; records: number };
  sealed: number;
  attestations: number;
  exceptions: { bySeverity: Record<string, number>; openGating: number };
  history: { tapeId: string; tapeName: string; signer: string; at: string; records: number; root: string }[];
}) {
  const tone = quality.score === null ? undefined
    : quality.score >= 90 ? "var(--color-ok)"
    : quality.score >= 70 ? "var(--color-warn)" : "var(--color-crit)";

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 stagger">
        <Stat label="Data quality" count={quality.score ?? 0} decimals={1} suffix="%" tone={tone}
          sub={`${quality.cleanRows.toLocaleString("en-US")} of ${quality.records.toLocaleString("en-US")} rows carry no exception`} />
        <Stat label="Sealed loans" count={sealed}
          sub={attestations === 1 ? "under one attestation" : `under ${attestations} attestations`} />
        <Stat label="Rows with findings" count={quality.rowsWithExceptions}
          sub={`${(exceptions.bySeverity.BLOCKER ?? 0) + (exceptions.bySeverity.CRITICAL ?? 0)} gating, ${exceptions.bySeverity.WARNING ?? 0} warnings`} />
        <Stat label="Open and gating" count={exceptions.openGating}
          tone={exceptions.openGating > 0 ? "var(--color-crit)" : "var(--color-ok)"}
          sub={exceptions.openGating > 0 ? "some loans are not eligible to be sealed" : "nothing is blocking a sign-off"} />
      </div>

      <section className="card p-5 flex flex-col gap-3 rise">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-base font-semibold">Verification history</h2>
          <span className="text-[0.7rem] text-muted">
            every sign-off, with who signed it and the root they signed
          </span>
        </div>

        {history.length === 0 ? (
          <p className="text-sm text-muted">
            Nothing has been signed off yet. A Reviewer seals a tape once no blocking or
            critical exception remains open.
          </p>
        ) : (
          <table className="dtable">
            <thead>
              <tr><th>Tape</th><th>Signed by</th><th>When</th><th className="tnum">Loans</th><th>Merkle root</th><th /></tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.tapeId}>
                  <td className="text-xs"><Link href={`/tapes/${h.tapeId}`}>{h.tapeName}</Link></td>
                  <td className="text-xs text-muted">{h.signer}</td>
                  <td className="text-xs text-muted">{new Date(h.at).toLocaleString()}</td>
                  <td className="tnum mono text-xs text-right">{h.records}</td>
                  <td className="mono text-[0.62rem] text-muted" title={h.root}>{h.root.slice(0, 20)}…</td>
                  <td>
                    <a className="text-xs" href={`/api/v1/verify/${h.tapeId}`} target="_blank" rel="noreferrer">
                      re-verify
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="text-[0.68rem] text-muted">
          &ldquo;Re-verify&rdquo; recomputes the chain and the root from the live rows, right now, and
          needs no credential — anyone can check a tape, nobody can change it.
        </p>
      </section>
    </div>
  );
}
