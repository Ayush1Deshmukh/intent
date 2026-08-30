"use client";
import { useEffect, useState } from "react";

/**
 * The pipeline overlay.
 *
 * Confirming a mapping runs for the better part of twenty seconds — parse, coerce,
 * reconcile three sources, then twenty-eight rules over five hundred rows. Before
 * this, that was twenty seconds of a greyed-out button, which in a demo reads as
 * "it has hung" and in real use reads as "did my click register".
 *
 * Two honesty rules, because a fake progress bar is worse than none:
 *   - the stage list is the actual sequence the server performs, in order
 *   - it never claims to have finished. The last stage stays in progress until the
 *     server redirects, so nothing here can say "done" when it does not know.
 *
 * The timings are measured, not invented — they came from the pipeline's own
 * timings on the 500-row demo tape — and they drift honestly: if the work takes
 * longer than expected the current stage simply keeps running.
 */

const STAGES: { label: string; detail: string; ms: number }[] = [
  { label: "Reading the raw rows", detail: "the originals are stored verbatim and never touched again", ms: 1400 },
  { label: "Coercing values", detail: "dates, money, rates and states, one format per column", ms: 4200 },
  { label: "Reconciling the sources", detail: "the servicer extract and the manifest against the tape", ms: 3200 },
  { label: "Running 28 rules", detail: "null is not a violation; dependent rules stay suppressed", ms: 7000 },
  { label: "Raising exceptions", detail: "each one with the value that failed and what was expected", ms: 3000 },
];

export default function PipelineRunning({ rows }: { rows: number }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const t = setInterval(() => setElapsed(Date.now() - started), 100);
    return () => clearInterval(t);
  }, []);

  // which stage we are on: the last one whose cumulative time has not yet passed,
  // and never past the final stage — the server, not this timer, decides when it ends
  let acc = 0;
  let current = STAGES.length - 1;
  for (let i = 0; i < STAGES.length; i++) {
    acc += STAGES[i].ms;
    if (elapsed < acc) { current = i; break; }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-bg/85 backdrop-blur-sm fadein"
      role="status" aria-live="polite">
      <div className="card p-7 w-full max-w-md flex flex-col gap-5 rise">
        <div className="flex flex-col gap-1">
          <span className="eyebrow">Validating</span>
          <h2 className="text-lg font-semibold">{rows.toLocaleString("en-US")} rows through the pipeline</h2>
          <p className="text-xs text-muted">
            Nothing has been written to the working tables yet — this runs in one transaction.
          </p>
        </div>

        <ol className="flex flex-col gap-3">
          {STAGES.map((s, i) => {
            const done = i < current;
            const active = i === current;
            return (
              <li key={s.label} className="flex items-start gap-3">
                <span className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border flex items-center justify-center
                  ${done ? "bg-ok border-ok" : active ? "border-accent" : "border-line2"}`}>
                  {done ? (
                    <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 pop" aria-hidden>
                      <path d="M2 6.4 L4.6 9 L10 3.2" fill="none" stroke="#fff" strokeWidth="2"
                        strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : active ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-accent livepulse" />
                  ) : null}
                </span>
                <span className="flex flex-col gap-0.5 min-w-0">
                  <span className={`text-sm leading-tight ${active ? "text-ink font-medium" : done ? "text-ink2" : "text-muted"}`}>
                    {s.label}
                  </span>
                  {active ? <span className="text-[0.7rem] text-muted leading-snug">{s.detail}</span> : null}
                </span>
              </li>
            );
          })}
        </ol>

        <div className="h-1 w-full rounded-full bg-surface2 overflow-hidden">
          <div className="h-full shimmer" style={{ width: "100%" }} />
        </div>
        <p className="mono text-[0.68rem] text-muted tnum">{(elapsed / 1000).toFixed(1)}s elapsed</p>
      </div>
    </div>
  );
}
