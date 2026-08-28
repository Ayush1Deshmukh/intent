import Link from "next/link";
import { ReactNode } from "react";

export function Chip({ children, tone = "accent" }: { children: ReactNode; tone?: "accent" | "brass" | "ok" | "warn" | "crit" | "muted" }) {
  const map = {
    accent: "bg-accentsoft text-accent", brass: "bg-brasssoft text-brass",
    ok: "bg-oksoft text-ok", warn: "bg-warnsoft text-warn",
    crit: "bg-critsoft text-crit", muted: "bg-surface2 text-muted",
  } as const;
  return <span className={`chip ${map[tone]}`}>{children}</span>;
}

export function SeverityChip({ severity }: { severity: string }) {
  return <span className={`chip sev-${severity}`}>{severity.toLowerCase()}</span>;
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className="card p-4 flex flex-col gap-1">
      <span className="eyebrow">{label}</span>
      <span className="text-2xl font-serif font-semibold tnum" style={tone ? { color: tone } : undefined}>{value}</span>
      {sub ? <span className="text-xs text-muted">{sub}</span> : null}
    </div>
  );
}

export function SeverityBar({ counts }: { counts: Record<string, number> }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const seg = [
    { k: "BLOCKER", c: "var(--color-crit)" },
    { k: "CRITICAL", c: "#c9564a" },
    { k: "WARNING", c: "var(--color-warn)" },
    { k: "INFO", c: "var(--color-accent)" },
  ];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface2">
        {seg.map((s) => (counts[s.k] ? (
          <div key={s.k} style={{ width: `${(counts[s.k] / total) * 100}%`, background: s.c }} title={`${s.k} ${counts[s.k]}`} />
        ) : null))}
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-muted">
        {seg.map((s) => (
          <span key={s.k} className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.c }} />
            <span className="mono tnum">{counts[s.k] ?? 0}</span> {s.k.toLowerCase()}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="card p-10 text-center flex flex-col gap-2">
      <p className="font-serif text-lg">{title}</p>
      {hint ? <p className="text-sm text-muted max-w-md mx-auto">{hint}</p> : null}
    </div>
  );
}

export function Hash({ value, len = 12 }: { value: string; len?: number }) {
  return <span className="mono text-xs text-muted" title={value}>{value.slice(0, len)}…</span>;
}

export function Crumb({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="text-sm hover:underline">{children}</Link>;
}

/**
 * What a finding is about. Three cases, and conflating them is misleading:
 * a real loan id; a row that exists but arrived with no identifier (itself the
 * defect STR-001 is reporting); and a finding about the tape as a whole.
 */
export function Subject({ loanId, rowNumber, className = "" }: {
  loanId: string | null; rowNumber: number | null; className?: string;
}) {
  if (loanId) return <span className={`mono text-xs whitespace-nowrap ${className}`}>{loanId}</span>;
  if (rowNumber != null) {
    return (
      <span className={`mono text-xs whitespace-nowrap text-muted ${className}`} title="This row exists but arrived without a loan identifier">
        row {rowNumber} <span className="not-italic">· no id</span>
      </span>
    );
  }
  return <span className={`text-xs text-muted whitespace-nowrap ${className}`}>tape-level</span>;
}

export const subjectLabel = (loanId: string | null, rowNumber: number | null) =>
  loanId || (rowNumber != null ? `row ${rowNumber} · no id` : "tape-level");
