import { buildOpenApi } from "@/lib/openapi";
import { provider } from "@/lib/ai/client";

export const dynamic = "force-dynamic";

type Op = {
  tags?: string[]; summary?: string; description?: string; security?: unknown[];
  parameters?: { name: string; in: string; required?: boolean; schema?: { type?: string } }[];
  requestBody?: { content?: Record<string, unknown> };
  responses?: Record<string, { description?: string }>;
};

const METHOD_TONE: Record<string, string> = {
  get: "bg-accentsoft text-accent",
  post: "bg-brasssoft text-brass",
  put: "bg-brasssoft text-brass",
  delete: "bg-critsoft text-crit",
};

export default function DocsPage() {
  const spec = buildOpenApi("") as unknown as {
    info: { title: string; version: string; description: string };
    tags: { name: string; description: string }[];
    paths: Record<string, Record<string, Op>>;
    components: { schemas: Record<string, { properties?: Record<string, { type?: string; title?: string; nullable?: boolean; description?: string; enum?: string[] }>; required?: string[] }> };
  };

  const byTag = new Map<string, { path: string; method: string; op: Op }[]>();
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      const tag = op.tags?.[0] ?? "Other";
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag)!.push({ path, method, op });
    }
  }

  const loan = spec.components.schemas.LoanRecord;

  return (
    <div className="flex flex-col gap-8 max-w-5xl">
      <header className="flex flex-col gap-2">
        <span className="eyebrow">OpenAPI 3.1 · v{spec.info.version}</span>
        <h1 className="text-2xl font-semibold">{spec.info.title}</h1>
        <div className="text-sm text-ink2 max-w-prose flex flex-col gap-2">
          {spec.info.description.split("\n\n").map((p, i) => (
            <p key={i} dangerouslySetInnerHTML={{ __html: p.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>") }} />
          ))}
        </div>
        <div className="flex gap-2 pt-1">
          <a className="btn btn-sm no-underline" href="/api/openapi" target="_blank" rel="noreferrer">Raw OpenAPI JSON</a>
        </div>
        <AiStatus />
      </header>

      {spec.tags.map((tag) => {
        const ops = byTag.get(tag.name) ?? [];
        if (!ops.length) return null;
        return (
          <section key={tag.name} className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-lg font-semibold">{tag.name}</h2>
              <p className="text-xs text-muted">{tag.description}</p>
            </div>
            {ops.map(({ path, method, op }) => (
              <article key={path + method} className="card p-4 flex flex-col gap-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className={`chip ${METHOD_TONE[method] ?? "bg-surface2 text-muted"}`}>{method}</span>
                  <span className="mono text-sm font-medium">{path}</span>
                  {op.security && op.security.length === 0
                    ? <span className="chip bg-oksoft text-ok">public</span>
                    : null}
                </div>
                <p className="text-sm font-medium">{op.summary}</p>
                {op.description ? (
                  <p
                    className="text-sm text-ink2 leading-relaxed"
                    dangerouslySetInnerHTML={{
                      __html: op.description
                        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
                        .replace(/`(.+?)`/g, '<code class="mono text-xs bg-surface2 px-1 py-0.5 rounded">$1</code>'),
                    }}
                  />
                ) : null}

                {op.parameters?.length ? (
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {op.parameters.map((p) => (
                      <span key={p.name + p.in} className="text-xs">
                        <span className="mono">{p.name}</span>
                        <span className="text-muted"> ({p.in}{p.required ? ", required" : ""})</span>
                      </span>
                    ))}
                  </div>
                ) : null}

                {op.responses ? (
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {Object.entries(op.responses).map(([code, r]) => (
                      <span key={code} className="text-xs">
                        <span className={`mono ${code.startsWith("2") ? "text-ok" : "text-crit"}`}>{code}</span>
                        <span className="text-muted"> {r.description ?? "problem+json"}</span>
                      </span>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </section>
        );
      })}

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-lg font-semibold">The canonical loan record</h2>
          <p className="text-xs text-muted">
            Generated from the same field dictionary the ingest pipeline maps onto, so this table cannot drift from the code.
          </p>
        </div>
        <div className="card overflow-hidden">
          <table className="dtable">
            <thead><tr><th>Field</th><th>Type</th><th>Required</th><th>Notes</th></tr></thead>
            <tbody>
              {Object.entries(loan.properties ?? {}).map(([name, p]) => (
                <tr key={name}>
                  <td className="mono text-xs">{name}</td>
                  <td className="text-xs">{p.type}</td>
                  <td>{loan.required?.includes(name) ? <span className="chip bg-critsoft text-crit">required</span> : <span className="text-muted text-xs">—</span>}</td>
                  <td className="text-xs text-muted">{p.enum ? p.enum.join(" · ") : p.description ?? p.title}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/**
 * What is actually answering the AI endpoints on this instance, stated plainly.
 *
 * Worth its own panel because the honest answer is sometimes "nothing" — every AI
 * feature has a deterministic twin, and an instance with no key configured is a
 * working demo rather than a broken one. A reader should not have to guess which
 * of the two they are looking at.
 */
function AiStatus() {
  const p = provider();
  return (
    <div className="card p-4 flex flex-col gap-2 mt-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="eyebrow">AI on this instance</span>
        {p ? (
          <>
            <span className="chip bg-accentsoft text-accent">{p.label}</span>
            <span className="chip bg-surface2 text-muted mono">{p.model}</span>
          </>
        ) : (
          <span className="chip bg-surface2 text-muted">deterministic only — no provider configured</span>
        )}
      </div>
      <p className="text-sm text-ink2 max-w-prose">
        {p
          ? "Every response from this provider is validated against a schema before the application will accept it, and lands in the proposals table — never directly on a loan record. If a call fails or the key runs out, the deterministic twin answers instead and the UI says so."
          : "Explain, propose, cluster and rule-authoring are all running their deterministic twins. Nothing is degraded except the prose: exceptions are still explained, fixes are still proposed, and root-cause clusters are still found — by rules rather than by a model, and labelled as such."}
      </p>
      <p className="text-xs text-muted">
        The provider is configuration, not architecture (ADR 0002). Groq, Google Gemini,
        OpenRouter, Cerebras and a local Ollama all work, and all of them have a free tier —
        this project has no paid dependency.
      </p>
    </div>
  );
}
