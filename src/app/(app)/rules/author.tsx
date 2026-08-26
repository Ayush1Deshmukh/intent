"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Preview = { scanned: number; wouldFlag: number; sampleLoanIds: (string | null)[]; evaluationErrors: number };
type Draft = {
  name: string; description: string; category: string; severity: string;
  field?: string | null; expected: string; expression: unknown;
};

const EXAMPLES = [
  "flag loans where the credit score is under 600",
  "flag loans in California where the interest rate is above 10%",
  "flag any loan more than 60 days past due",
];

export default function RuleAuthor({ tapeId, tapeName }: { tapeId: string; tapeName: string }) {
  const router = useRouter();
  const [sentence, setSentence] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(previewOnly: boolean) {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/v1/rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          naturalLanguage: sentence, tapeId, previewOnly,
          rule: previewOnly ? undefined : draft,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.detail ?? "That did not work."); return; }
      if (previewOnly) { setDraft(json.rule); setPreview(json.preview); }
      else { setDraft(null); setPreview(null); setSentence(""); router.refresh(); }
    } finally { setBusy(false); }
  }

  return (
    <section className="card p-5 flex flex-col gap-3 border-l-2 border-brass">
      <div className="flex flex-col gap-1">
        <span className="eyebrow">Describe a rule</span>
        <p className="text-sm text-ink2">
          Type it in a sentence. It is compiled into the same expression language as every built-in rule,
          previewed against <strong>{tapeName}</strong>, and saved disabled until a Reviewer approves it.
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {EXAMPLES.map((e) => (
          <button key={e} className="chip bg-surface2 text-muted hover:text-ink" onClick={() => setSentence(e)}>{e}</button>
        ))}
      </div>

      <div className="flex gap-2 flex-wrap">
        <input
          value={sentence}
          onChange={(e) => setSentence(e.target.value)}
          className="flex-1 min-w-[280px]"
          placeholder="flag loans where the credit score is under 600"
        />
        <button className="btn btn-primary" disabled={busy || sentence.trim().length < 8} onClick={() => run(true)}>
          {busy ? "Compiling…" : "Compile and preview"}
        </button>
      </div>

      {error ? <p className="text-sm text-crit">{error}</p> : null}

      {draft && preview ? (
        <div className="flex flex-col gap-3 pt-2 border-t border-line">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-serif font-semibold">{draft.name}</span>
            <span className={`chip sev-${draft.severity}`}>{draft.severity.toLowerCase()}</span>
            <span className="chip bg-surface2 text-muted">{draft.category.replace("_", " ")}</span>
          </div>
          <p className="text-sm text-ink2">{draft.description}</p>
          <pre className="text-[0.68rem] mono bg-surface2 border border-line rounded-lg p-3 overflow-x-auto">
{JSON.stringify(draft.expression, null, 2)}
          </pre>
          <div className="flex items-center gap-4 flex-wrap text-sm">
            <span className="chip bg-brasssoft text-brass">would flag {preview.wouldFlag} of {preview.scanned}</span>
            {preview.sampleLoanIds.length ? (
              <span className="text-xs text-muted mono">{preview.sampleLoanIds.slice(0, 6).join(", ")}</span>
            ) : null}
            {preview.evaluationErrors
              ? <span className="chip bg-critsoft text-crit">{preview.evaluationErrors} evaluation errors</span>
              : null}
          </div>
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={busy} onClick={() => run(false)}>Save as a draft rule</button>
            <button className="btn" onClick={() => { setDraft(null); setPreview(null); }}>Discard</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
