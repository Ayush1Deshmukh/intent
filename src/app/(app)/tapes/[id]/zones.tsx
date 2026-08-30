import { Hash } from "@/components/ui";

/**
 * The three zones, on the screen rather than only in an ADR.
 *
 * Raw quarantine, active working, verified ledger — the separation this system is
 * built on, shown as what it actually is: the same loans in three states, with a
 * count and a rule for each. It reads left to right in the order data moves, and it
 * answers the question a reader has at this point on the page, which is "where has
 * my file got to".
 */
export default function Zones({ files, rows, exceptions, cleanRows, sealed, excluded }: {
  files: { kind: string; filename: string; sha256: string; rowCount: number }[];
  rows: number; exceptions: number; cleanRows: number;
  sealed: number; excluded: number;
}) {
  const rawRows = files.reduce((a, f) => a + f.rowCount, 0);

  return (
    <section className="card p-5 flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-base font-semibold">Where the data is</h2>
        <span className="text-[0.7rem] text-muted">
          three zones, never collapsed — raw is never mutated, verified is never written except by sign-off
        </span>
      </div>

      <ol className="grid gap-3 md:grid-cols-3 stagger">
        <Zone
          n={1} name="Raw quarantine" tone="var(--color-muted)"
          headline={rawRows.toLocaleString("en-US")} unit={rawRows === 1 ? "row" : "rows"}
          rule="stored verbatim, exactly as delivered, and never touched again"
        >
          <ul className="flex flex-col gap-1.5">
            {files.map((f) => (
              <li key={f.filename} className="flex flex-col">
                <span className="mono text-[0.68rem] truncate" title={f.filename}>{f.filename}</span>
                <span className="text-[0.62rem] text-muted flex items-center gap-1.5">
                  <span className="tnum">{f.rowCount} rows</span>
                  <span aria-hidden>·</span>
                  <Hash value={f.sha256} len={10} />
                </span>
              </li>
            ))}
          </ul>
        </Zone>

        <Zone
          n={2} name="Active working" tone="var(--color-accent)"
          headline={rows.toLocaleString("en-US")} unit={rows === 1 ? "record" : "records"}
          rule="typed and corrected — but only ever under maker-checker"
        >
          <dl className="flex flex-col gap-1 text-[0.7rem]">
            <Row label="carry no exception" value={cleanRows} tone="var(--color-ok)" />
            <Row label="exceptions raised" value={exceptions} tone={exceptions ? "var(--color-crit)" : undefined} />
          </dl>
        </Zone>

        <Zone
          n={3} name="Verified ledger" tone="var(--color-ok)"
          headline={sealed ? sealed.toLocaleString("en-US") : "—"} unit={sealed ? "sealed" : "nothing sealed yet"}
          rule="hash, lineage and signer, sealed; re-written only by a new sign-off"
        >
          {sealed ? (
            <dl className="flex flex-col gap-1 text-[0.7rem]">
              <Row label="loans excluded" value={excluded} tone={excluded ? "var(--color-warn)" : undefined} />
              <dt className="sr-only">note</dt>
              <dd className="text-muted leading-snug">
                Each carries the row it came from and the reviewer who signed it.
              </dd>
            </dl>
          ) : (
            <p className="text-[0.7rem] text-muted leading-snug">
              A Reviewer seals this zone once no blocking or critical exception remains open.
            </p>
          )}
        </Zone>
      </ol>
    </section>
  );
}

function Zone({ n, name, tone, headline, unit, rule, children }: {
  n: number; name: string; tone: string; headline: string; unit: string; rule: string;
  children: React.ReactNode;
}) {
  return (
    <li className="rounded-lg border border-line bg-bg p-3.5 flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: tone }} aria-hidden />
        <span className="eyebrow">Zone {n}</span>
        <span className="text-xs font-medium text-ink2">{name}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="font-serif text-xl font-semibold tnum">{headline}</span>
        <span className="text-[0.7rem] text-muted">{unit}</span>
      </div>
      {children}
      <p className="text-[0.65rem] text-muted leading-snug border-t border-line pt-2 mt-auto">{rule}</p>
    </li>
  );
}

function Row({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="mono tnum" style={tone ? { color: tone } : undefined}>{value.toLocaleString("en-US")}</dd>
    </div>
  );
}
