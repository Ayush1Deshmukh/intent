"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Subject, subjectLabel } from "@/components/ui";

type Row = {
  id: string; loanId: string | null; borrowerId: string | null; rowNumber: number | null;
  field: string | null; observed: string | null;
  expected: string | null; severity: string; status: string; clusterKey: string | null;
  ruleCode: string; ruleName: string; ruleDescription: string; category: string;
};
type Cluster = { key: string; label: string; rootCause: string; count: number;
  suggestedAction: string; source: string; confidence: number; exceptionIds?: string[] };

type Explain = { whatTheRuleChecks: string; likelyCause: string; downstreamRisk: string; source: string; model: string | null };
type Proposal = { id: string; field: string; fromValue: string | null; toValue: string | null;
  rationale: string; confidence: number; source: string; model: string | null;
  evidence: { label: string; value: string }[] | null; status: string;
  promptHash?: string | null; tokensIn?: number | null; tokensOut?: number | null;
  latencyMs?: number | null; createdAt?: string | null };

const SEVERITIES = ["BLOCKER", "CRITICAL", "WARNING", "INFO"];
const STATUSES = ["OPEN", "PENDING_APPROVAL", "RESOLVED", "WAIVED", "REJECTED"];

export default function Queue({ tapeId, rows, canAct, canWaive, canExclude }: {
  tapeId: string; rows: Row[]; canAct: boolean; canWaive: boolean; canExclude: boolean;
}) {
  const router = useRouter();
  const [sev, setSev] = useState<string[]>([]);
  const [status, setStatus] = useState<string[]>(["OPEN", "PENDING_APPROVAL"]);
  const [rule, setRule] = useState("");
  const [cluster, setCluster] = useState<string | null>(null);
  const [open, setOpen] = useState<Row | null>(null);
  const [showClusters, setShowClusters] = useState(false);
  const [q, setQ] = useState("");

  /**
   * Clusters are fetched when they are asked for, not when the page loads.
   *
   * They were computed during server render, which put a model call on the critical
   * path of a page whose clusters are hidden behind a toggle nobody had pressed yet.
   * On a cold cache that made the exception queue take longer to open than a browser's
   * default navigation timeout — for a result most visits never look at.
   */
  const [clusters, setClusters] = useState<Cluster[] | null>(null);
  const [clustering, setClustering] = useState(false);

  async function toggleClusters() {
    if (showClusters) { setShowClusters(false); return; }
    setShowClusters(true);
    if (clusters || clustering) return;
    setClustering(true);
    try {
      const res = await fetch(`/api/v1/tapes/${tapeId}/cluster`, { method: "POST" });
      const json = await res.json();
      setClusters((json.clusters ?? []).map((c: { key: string; label: string; rootCause: string;
        exceptionIds: string[]; suggestedAction: string; source: string; confidence: number }) => ({
        key: c.key, label: c.label, rootCause: c.rootCause, count: c.exceptionIds.length,
        suggestedAction: c.suggestedAction, source: c.source, confidence: c.confidence,
        exceptionIds: c.exceptionIds,
      })));
    } catch {
      setClusters([]);
    } finally { setClustering(false); }
  }

  /**
   * Cluster membership comes from the cluster itself, not from a key match.
   *
   * Rows carry the `clusterKey` the pipeline assigned them, but a model-named cluster
   * has a key of the model's own choosing — so filtering by key silently matched
   * nothing as soon as the AI path was live, and the only assertion covering it checked
   * that the filter *chip* appeared. Every cluster now reports the exception ids it
   * holds, and this filters by that set.
   */
  const clusterIds = useMemo(() => {
    if (!cluster) return null;
    const ids = clusters?.find((c) => c.key === cluster)?.exceptionIds;
    return ids ? new Set(ids) : null;
  }, [cluster, clusters]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) =>
      (sev.length === 0 || sev.includes(r.severity)) &&
      (status.length === 0 || status.includes(r.status)) &&
      (!rule || r.ruleCode === rule) &&
      (!cluster || (clusterIds ? clusterIds.has(r.id) : r.clusterKey === cluster)) &&
      (!needle
        || (r.loanId ?? "").toLowerCase().includes(needle)
        || (r.borrowerId ?? "").toLowerCase().includes(needle)
        || (r.field ?? "").toLowerCase().includes(needle)
        || (r.observed ?? "").toLowerCase().includes(needle)));
  }, [rows, sev, status, rule, cluster, clusterIds, q]);

  const ruleCodes = useMemo(() => [...new Set(rows.map((r) => r.ruleCode))].sort(), [rows]);
  const toggle = (list: string[], set: (v: string[]) => void, v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div className="flex flex-col gap-4">
      <div className="card p-3 flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="flex items-center gap-1.5">
          <span className="eyebrow">Severity</span>
          {SEVERITIES.map((s) => (
            <button key={s} onClick={() => toggle(sev, setSev, s)}
              className={`chip sev-${s} ${sev.includes(s) ? "ring-2 ring-offset-1 ring-current" : "opacity-55"}`}>
              {s.toLowerCase()}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="eyebrow">Status</span>
          {STATUSES.map((s) => (
            <button key={s} onClick={() => toggle(status, setStatus, s)}
              className={`chip ${status.includes(s) ? "bg-accentsoft text-accent" : "bg-surface2 text-muted"}`}>
              {s.replace("_", " ").toLowerCase()}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2">
          <span className="eyebrow">Find</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} className="w-52"
            placeholder="Loan or borrower id…" aria-label="Search by loan or borrower id" />
        </label>
        <label className="flex items-center gap-2">
          <span className="eyebrow">Rule</span>
          <select value={rule} onChange={(e) => setRule(e.target.value)} className="w-32">
            <option value="">all</option>
            {ruleCodes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <button className="btn btn-sm ml-auto" onClick={toggleClusters} disabled={clustering}>
          {clustering ? "Finding root causes…" : showClusters ? "Hide root causes" : "Group by root cause"}
        </button>
        <span className="mono text-xs text-muted tnum">{filtered.length} shown</span>
      </div>

      {showClusters && clustering ? (
        <div className="card p-5 flex flex-col gap-2.5 fadein" role="status" aria-live="polite">
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-accent livepulse" aria-hidden />
            <span className="eyebrow">Grouping {filtered.length} exceptions by cause</span>
          </span>
          <div className="h-1 w-full rounded-full bg-surface2 overflow-hidden"><div className="h-full shimmer w-full" /></div>
          <p className="text-[0.7rem] text-muted">
            The counts come from the engine, not the model — it is asked to merge and name the
            groups, never to decide which exception belongs to which.
          </p>
        </div>
      ) : null}

      {showClusters && !clustering && clusters ? (
        <div className="flex flex-col gap-2">
          {clusters.map((c) => (
            <div key={c.key} className={`card card-hover p-4 flex flex-col gap-2 rise ${cluster === c.key ? "ring-2 ring-accent" : ""}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <span className="flex items-center gap-2">
                    <span className="font-serif font-semibold">{c.label}</span>
                    <span className="chip bg-brasssoft text-brass">{c.count} exceptions</span>
                    <span className="chip bg-surface2 text-muted">{c.source === "RULE" ? "deterministic" : "model"} · {c.confidence.toFixed(2)}</span>
                  </span>
                  <p className="text-sm text-ink2 max-w-3xl">{c.rootCause}</p>
                  <p className="text-xs text-muted max-w-3xl"><strong>Suggested:</strong> {c.suggestedAction}</p>
                </div>
                <button className="btn btn-sm shrink-0"
                  onClick={() => { setCluster(cluster === c.key ? null : c.key); setShowClusters(false); }}>
                  {cluster === c.key ? "Clear filter" : "Show these"}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {cluster ? (
        <div className="flex items-center gap-2 text-sm">
          <span className="chip bg-brasssoft text-brass">root cause filter</span>
          <span className="text-ink2">{clusters?.find((c) => c.key === cluster)?.label ?? cluster}</span>
          <button className="btn btn-sm" onClick={() => setCluster(null)}>clear</button>
        </div>
      ) : null}

      <div className="card overflow-hidden">
        <div className="max-h-[62vh] overflow-auto">
          <table className="dtable">
            <thead>
              <tr><th>Loan</th><th>Rule</th><th>Field</th><th>Observed</th><th>Expected</th><th>Severity</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.slice(0, 400).map((r) => (
                <tr key={r.id}>
                  <td><Subject loanId={r.loanId} rowNumber={r.rowNumber} /></td>
                  <td><span className="mono text-xs text-muted">{r.ruleCode}</span> <span className="block text-xs">{r.ruleName}</span></td>
                  <td className="mono text-xs">{r.field ?? "—"}</td>
                  <td className="max-w-[220px] truncate" title={r.observed ?? ""}>{r.observed ?? "—"}</td>
                  <td className="max-w-[200px] truncate text-muted" title={r.expected ?? ""}>{r.expected}</td>
                  <td><span className={`chip sev-${r.severity}`}>{r.severity.toLowerCase()}</span></td>
                  <td><span className="chip bg-surface2 text-muted">{r.status.replace("_", " ").toLowerCase()}</span></td>
                  <td><button className="btn btn-sm" onClick={() => setOpen(r)}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length > 400 ? <p className="p-3 text-xs text-muted">Showing the first 400 of {filtered.length}. Narrow the filters to see the rest.</p> : null}
      </div>

      {open ? (
        <Drawer row={open} canAct={canAct} canWaive={canWaive} canExclude={canExclude}
          onClose={() => { setOpen(null); router.refresh(); }} />
      ) : null}
    </div>
  );
}

/**
 * The wait, made legible.
 *
 * A cold proposal takes about nine seconds on a free tier — measured, not guessed —
 * and nine seconds of a greyed-out button reads as a hang. This says what is happening
 * and, more usefully, what will happen next: that whatever comes back is a proposal
 * requiring two people, not an edit. That sentence is worth more on screen while the
 * model is thinking than after it has answered.
 */
function Working({ kind }: { kind: "explain" | "propose" }) {
  return (
    <div className="card p-3.5 flex flex-col gap-2 bg-bg fadein" role="status" aria-live="polite">
      <span className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-accent livepulse" aria-hidden />
        <span className="eyebrow">
          {kind === "explain" ? "Reading the rule and the row" : "Deriving a corrected value"}
        </span>
      </span>
      <div className="h-1 w-full rounded-full bg-surface2 overflow-hidden">
        <div className="h-full shimmer w-full" />
      </div>
      <p className="text-[0.7rem] text-muted leading-snug">
        {kind === "explain"
          ? "If the model is unavailable this falls back to the rule's own description, and the panel will say so."
          : "Whatever comes back is a proposal. It cannot change this loan — an operator has to accept it and a different person has to approve it."}
      </p>
    </div>
  );
}

function Drawer({ row, canAct, canWaive, canExclude, onClose }: {
  row: Row; canAct: boolean; canWaive: boolean; canExclude: boolean; onClose: () => void;
}) {
  const [explain, setExplain] = useState<Explain | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState<string | null>(null);   // the edited value, while editing
  const [showMeta, setShowMeta] = useState(false);

  async function call(what: string, url: string, body?: unknown) {
    setBusy(what); setMsg(null);
    try {
      const res = await fetch(url, {
        method: "POST", headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json();
      if (!res.ok) { setMsg({ tone: "err", text: json.detail ?? "That did not work." }); return null; }
      return json;
    } finally { setBusy(null); }
  }

  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/25 fadein" onClick={onClose}>
      <aside className="w-full max-w-xl h-full bg-surface border-l border-line overflow-auto p-6 flex flex-col gap-5 slidein"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="eyebrow">{row.category.replace("_", " ")} · {row.ruleCode}</span>
            <h2 className="text-lg font-semibold">{row.ruleName}</h2>
            <span className="mono text-xs text-muted">{subjectLabel(row.loanId, row.rowNumber)}</span>
          </div>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>

        <div className="card p-4 flex flex-col gap-2 bg-bg">
          <div className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-1.5 text-sm">
            <span className="eyebrow pt-0.5">Field</span><span className="mono text-xs">{row.field ?? "—"}</span>
            <span className="eyebrow pt-0.5">Observed</span><span className="break-words">{row.observed ?? "—"}</span>
            <span className="eyebrow pt-0.5">Expected</span><span className="text-ink2">{row.expected}</span>
            <span className="eyebrow pt-0.5">Severity</span><span><span className={`chip sev-${row.severity}`}>{row.severity.toLowerCase()}</span></span>
          </div>
        </div>

        <p className="text-sm text-ink2 leading-relaxed">{row.ruleDescription}</p>

        <div className="flex gap-2 flex-wrap">
          <button className="btn btn-sm" disabled={busy !== null}
            onClick={async () => { const r = await call("explain", `/api/v1/exceptions/${row.id}/explain`); if (r) setExplain(r); }}>
            {busy === "explain" ? "Thinking…" : explain ? "Explain again" : "Explain"}
          </button>
          {canAct ? (
            <button className="btn btn-sm btn-primary" disabled={busy !== null}
              onClick={async () => { const r = await call("propose", `/api/v1/exceptions/${row.id}/proposals`, { mode: "ai" }); if (r) setProposal(r); }}>
              {busy === "propose" ? "Deriving…" : "Propose a fix"}
            </button>
          ) : null}
        </div>

        {busy === "explain" || busy === "propose" ? <Working kind={busy} /> : null}

        {explain ? (
          <div className="card p-4 flex flex-col gap-3 border-l-2 border-brass">
            <span className="flex items-center gap-2">
              <span className="eyebrow">Explanation</span>
              <span className="chip bg-surface2 text-muted">{explain.source === "RULE" ? "rule-based, no model" : `model · ${explain.model}`}</span>
            </span>
            {[["What the rule checks", explain.whatTheRuleChecks],
              ["Likely cause", explain.likelyCause],
              ["If left unfixed", explain.downstreamRisk]].map(([h, b]) => (
              <div key={h}><p className="eyebrow mb-1">{h}</p><p className="text-sm text-ink2 leading-relaxed">{b}</p></div>
            ))}
          </div>
        ) : null}

        {proposal ? (
          <div className="card p-4 flex flex-col gap-3 border-l-2 border-accent">
            <span className="flex items-center gap-2 flex-wrap">
              <span className="eyebrow">Proposed change</span>
              <span className="chip bg-surface2 text-muted">
                {proposal.source === "RULE" ? "rule-based suggestion" : proposal.source === "HUMAN" ? "entered by hand" : `model · ${proposal.model}`}
              </span>
              <span className={`chip ${proposal.confidence >= 0.6 ? "bg-oksoft text-ok" : "bg-warnsoft text-warn"}`}>
                confidence {proposal.confidence.toFixed(2)}
              </span>
            </span>

            <div className="flex items-center gap-3 text-sm">
              <span className="mono px-2 py-1 rounded bg-critsoft text-crit line-through">{proposal.fromValue ?? "empty"}</span>
              <span className="text-muted">→</span>
              <span className="mono px-2 py-1 rounded bg-oksoft text-ok">{proposal.toValue ?? "empty"}</span>
            </div>

            <p className="text-sm text-ink2 leading-relaxed">{proposal.rationale}</p>

            {/* Required AI control: the metadata behind the suggestion, on the record and
                on the screen. Collapsed because a reviewer does not need it to decide —
                but they must be able to get at it without leaving the page. */}
            <div className="flex flex-col gap-1.5">
              <button type="button" className="text-[0.7rem] text-muted text-left underline decoration-dotted"
                onClick={() => setShowMeta((v) => !v)}>
                {showMeta ? "Hide" : "Show"} what produced this
              </button>
              {showMeta ? (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[0.68rem] fadein">
                  <dt className="text-muted">Produced by</dt>
                  <dd className="mono">{proposal.source === "AI" ? (proposal.model ?? "model") : proposal.source === "RULE" ? "deterministic repair, no model" : "a person"}</dd>
                  <dt className="text-muted">Confidence</dt>
                  <dd className="mono tnum">{proposal.confidence.toFixed(2)}</dd>
                  {proposal.promptHash ? (<><dt className="text-muted">Prompt hash</dt>
                    <dd className="mono break-all">{proposal.promptHash.slice(0, 32)}…</dd></>) : null}
                  {proposal.tokensIn != null ? (<><dt className="text-muted">Tokens</dt>
                    <dd className="mono tnum">{proposal.tokensIn} in · {proposal.tokensOut ?? 0} out</dd></>) : null}
                  {proposal.latencyMs != null ? (<><dt className="text-muted">Latency</dt>
                    <dd className="mono tnum">{proposal.latencyMs} ms</dd></>) : null}
                  {proposal.createdAt ? (<><dt className="text-muted">At</dt>
                    <dd className="mono">{new Date(proposal.createdAt).toLocaleString()}</dd></>) : null}
                  <dt className="text-muted">Recorded</dt>
                  <dd>in the audit chain, whatever is decided next</dd>
                </dl>
              ) : null}
            </div>

            {proposal.evidence?.length ? (
              <div className="flex flex-col gap-1">
                <span className="eyebrow">Evidence</span>
                {proposal.evidence.map((e, i) => (
                  <div key={i} className="flex gap-2 text-xs"><span className="text-muted w-28 shrink-0">{e.label}</span><span className="mono break-all">{e.value}</span></div>
                ))}
              </div>
            ) : null}

            <div className="p-3 rounded-lg bg-accentsoft text-xs text-accent">
              Accepting this creates a <strong>pending change</strong>. The loan record is not touched until a
              Reviewer approves it — and the person who accepts cannot be the person who approves.
            </div>

            {canAct && proposal.status === "DRAFT" ? (
              editing === null ? (
                <div className="flex gap-2 flex-wrap">
                  <button className="btn btn-sm btn-primary" disabled={busy !== null}
                    onClick={async () => {
                      const r = await call("accept", `/api/v1/proposals/${proposal.id}/decision`, { action: "accept", reason });
                      if (r) setMsg({ tone: "ok", text: "Accepted. It is now a pending change waiting for a Reviewer." });
                    }}>Accept</button>
                  <button className="btn btn-sm" disabled={busy !== null}
                    onClick={() => setEditing(proposal.toValue ?? "")}>Edit the value</button>
                  <button className="btn btn-sm" disabled={busy !== null || reason.trim().length < 4}
                    onClick={async () => {
                      const r = await call("reject", `/api/v1/proposals/${proposal.id}/decision`, { action: "reject", reason });
                      if (r) { setProposal(null); setMsg({ tone: "ok", text: "Rejected. The exception is open again." }); }
                    }}>Reject (needs a reason)</button>
                </div>
              ) : (
                /* Editing does not overwrite the suggestion — it files a new one, by hand,
                   alongside it. Both stay in the audit trail, so what the model proposed and
                   what the person actually chose are separately answerable afterwards. */
                <div className="card p-3 flex flex-col gap-2 bg-bg">
                  <span className="eyebrow">Your value for {proposal.field}</span>
                  <input value={editing} onChange={(e) => setEditing(e.target.value)}
                    placeholder="leave empty to set the field to null" autoFocus />
                  <p className="text-[0.68rem] text-muted">
                    This files a separate proposal marked <strong>entered by hand</strong>. The model&rsquo;s
                    suggestion is kept and rejected on the record, so the audit trail shows both.
                  </p>
                  <div className="flex gap-2">
                    <button className="btn btn-sm btn-primary" disabled={busy !== null}
                      onClick={async () => {
                        const mine = await call("edit", `/api/v1/exceptions/${row.id}/proposals`, {
                          mode: "manual", field: proposal.field, toValue: editing,
                          rationale: reason.trim() ||
                            `Entered by hand in place of the ${proposal.source === "AI" ? "model's" : "rule-based"} suggestion of ${proposal.toValue ?? "empty"}.`,
                        });
                        if (!mine) return;
                        await call("reject", `/api/v1/proposals/${proposal.id}/decision`, {
                          action: "reject", reason: "Superseded by a value entered by hand.",
                        });
                        setEditing(null);
                        setProposal({ ...mine, status: "DRAFT" });
                        setMsg({ tone: "ok", text: "Your value is filed. Accept it to send it for approval." });
                      }}>Use my value</button>
                    <button className="btn btn-sm" disabled={busy !== null}
                      onClick={() => setEditing(null)}>Cancel</button>
                  </div>
                </div>
              )
            ) : null}
          </div>
        ) : null}

        {canExclude && row.loanId !== undefined && (row.severity === "BLOCKER" || row.severity === "CRITICAL")
          && (row.status === "OPEN" || row.status === "PENDING_APPROVAL") ? (
          <div className="card p-4 flex flex-col gap-2 border-l-2 border-crit">
            <span className="eyebrow">Drop this loan from the tape</span>
            <p className="text-xs text-muted">
              A blocking exception cannot be waived. When there is no defensible repair — no
              identifier at all, or two sources that cannot say which of them is wrong — the loan
              is excluded rather than guessed at. It never enters the verified ledger, and the
              count and the reason go into the attestation.
            </p>
            <button className="btn btn-sm btn-danger self-start" disabled={busy !== null || reason.trim().length < 4}
              onClick={async () => {
                const r = await call("exclude", `/api/v1/exceptions/${row.id}/exclude`, { reason });
                if (r) setMsg({ tone: "ok", text: `Excluded${r.loanId ? ` ${r.loanId}` : ""} from the tape, closing ${r.closed} open exception${r.closed === 1 ? "" : "s"} on it.` });
              }}>Exclude this loan (needs a reason)</button>
          </div>
        ) : null}

        {canWaive && (row.severity === "WARNING" || row.severity === "INFO") ? (
          <div className="card p-4 flex flex-col gap-2">
            <span className="eyebrow">Waive</span>
            <p className="text-xs text-muted">Warnings can be waived with a written reason. Blockers and criticals cannot.</p>
            <button className="btn btn-sm" disabled={busy !== null || reason.trim().length < 4}
              onClick={async () => {
                const r = await call("waive", `/api/v1/exceptions/${row.id}/waive`, { reason });
                if (r) setMsg({ tone: "ok", text: "Waived, with your reason recorded in the audit chain." });
              }}>Waive this exception</button>
          </div>
        ) : null}

        <label className="flex flex-col gap-1.5">
          <span className="eyebrow">Reason / note</span>
          <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Recorded in the audit chain alongside your decision" />
        </label>

        {msg ? <p className={`text-sm ${msg.tone === "ok" ? "text-ok" : "text-crit"}`}>{msg.text}</p> : null}
      </aside>
    </div>
  );
}
