/**
 * The whole product in five steps, on the sign-in screen.
 *
 * Someone seeing this for the first time has about ten seconds before they pick a
 * role, and the three principles above this tell them what the system believes but
 * not what it does. This is what it does, in the order it does it, with the real
 * numbers from the demo tape so the claims are checkable rather than aspirational.
 */

const STEPS: { n: string; title: string; body: string; tone?: "accent" | "brass" | "ok" }[] = [
  {
    n: "01", title: "Three files arrive, disagreeing",
    body: "A loan tape, a servicer extract five days newer, and a document manifest. Headers like “Curr Bal ”, Excel serial dates, a column called Col_17.",
  },
  {
    n: "02", title: "Normalized once, per column",
    body: "A date column resolves to one format from its own distribution — never cell by cell, which is how 03/04 and 13/04 end up in different calendars.",
  },
  {
    n: "03", title: "28 rules, deterministic", tone: "accent",
    body: "500 rows in, 209 exceptions out. A blank field is one finding, not four, and a bad rate does not also fail the check computed from it.",
  },
  {
    n: "04", title: "Two people, or nothing moves", tone: "brass",
    body: "The model proposes. An operator accepts. A different person approves. That is the only path by which a loan value ever changes.",
  },
  {
    n: "05", title: "Sealed, and checkable by anyone", tone: "ok",
    body: "A hash chain over every event and a Merkle root over every sealed loan. Edit the database directly and the check names the loan you touched.",
  },
];

const TONE = {
  accent: "var(--color-accent)",
  brass: "var(--color-brass)",
  ok: "var(--color-ok)",
} as const;

export default function Pipeline() {
  return (
    <ol className="flex flex-col relative stagger">
      {STEPS.map((s, i) => (
        <li key={s.n} className="flex gap-4 pb-5 last:pb-0 relative">
          {/* the spine, drawn between the markers rather than behind them */}
          {i < STEPS.length - 1 ? (
            <span className="absolute left-[11px] top-6 bottom-0 w-px bg-line" aria-hidden />
          ) : null}

          <span className="relative z-10 mt-0.5 h-[23px] w-[23px] shrink-0 rounded-full border border-line
                           bg-surface flex items-center justify-center mono text-[0.58rem] tracking-tight"
            style={s.tone ? { borderColor: TONE[s.tone], color: TONE[s.tone] } : { color: "var(--color-muted)" }}>
            {s.n}
          </span>

          <span className="flex flex-col gap-1 min-w-0">
            <span className="text-sm font-medium leading-tight">{s.title}</span>
            <span className="text-[0.78rem] text-muted leading-relaxed">{s.body}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
