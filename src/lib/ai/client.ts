import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, aiCache } from "@/lib/db";
import { EXPLAIN_JSON_SCHEMA, PROPOSE_JSON_SCHEMA, CLUSTER_JSON_SCHEMA } from "./schemas";
import { resolveProvider, type ResolvedProvider } from "./providers";

export type AiJob = "explain" | "propose" | "cluster" | "author";

export type AiResult<T> =
  | { ok: true; data: T; source: "AI" | "CACHE"; model: string; promptHash: string;
      promptText: string; responseText: string; tokensIn: number; tokensOut: number; latencyMs: number }
  | { ok: false; reason: string; promptHash: string; promptText: string };

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Per job: how much room the model gets, how hard it should think, and the JSON
 * schema the server should constrain it to.
 *
 * `maxTokens` has to cover reasoning as well as the answer — on current models
 * thinking is on by default and is billed against the same ceiling, so the old
 * 500-token caps would have truncated mid-object. `author` deliberately has no
 * schema: its output carries a rule expression from an open, recursive DSL, and
 * pinning that into a JSON Schema would freeze the grammar in two places.
 */
const JOB: Record<AiJob, { maxTokens: number; effort: Effort; schema?: Record<string, unknown> }> = {
  explain: { maxTokens: 4000, effort: "low", schema: EXPLAIN_JSON_SCHEMA },
  propose: { maxTokens: 6000, effort: "medium", schema: PROPOSE_JSON_SCHEMA },
  cluster: { maxTokens: 12000, effort: "medium", schema: CLUSTER_JSON_SCHEMA },
  author: { maxTokens: 8000, effort: "medium" },
};

export const provider = (): ResolvedProvider | null => resolveProvider();
export const aiEnabled = () => provider() !== null;
export const modelName = () => provider()?.model ?? "none";
export const providerLabel = () => provider()?.label ?? "deterministic only";

/**
 * Reasoning models on several providers wrap their scratchpad in <think> tags and
 * then answer. Strip that first: it frequently contains a draft JSON object, and
 * grabbing the first brace in the raw text would parse the draft instead of the answer.
 */
function extractJson(text: string): unknown {
  const body0 = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fenced = body0.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : body0).trim();
  const start = body.search(/[{[]/);
  if (start === -1) throw new Error("no JSON object in the response");
  return JSON.parse(body.slice(start));
}

function extractJsonSafe(text: string): unknown {
  try { return extractJson(text); } catch { return null; }
}

type Call = {
  system: string; user: string; maxTokens: number; effort: Effort;
  schema?: Record<string, unknown>; jobName: string;
};
type Raw = { text: string; tokensIn: number; tokensOut: number; refused?: boolean };

class BadSchemaError extends Error {}
class AuthError extends Error {}

/* ------------------------------------------------------------ OpenAI-shaped */

/**
 * One transport for Groq, Gemini's compatibility endpoint, OpenRouter, Cerebras,
 * Together and a local Ollama. Plain fetch on purpose — adding a provider SDK per
 * vendor would buy nothing here and cost a dependency each.
 *
 * Unlike the Anthropic models, these accept sampling parameters, so temperature 0
 * is both allowed and wanted.
 */
async function callOpenAiShaped(p: ResolvedProvider, c: Call, useSchema: boolean): Promise<Raw> {
  const body: Record<string, unknown> = {
    model: p.model,
    temperature: 0,
    max_tokens: c.maxTokens,
    messages: [
      { role: "system", content: c.system },
      { role: "user", content: c.user },
    ],
  };
  if (useSchema && c.schema) {
    body.response_format = p.jsonSchema
      ? { type: "json_schema", json_schema: { name: c.jobName, strict: true, schema: c.schema } }
      : { type: "json_object" };
  }

  const res = await fetch(`${p.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 400);
    if (res.status === 401 || res.status === 403) throw new AuthError(detail);
    // A provider that does not know this response_format says so with a 400. Retrying
    // without it is better than losing the feature — the Zod gate still holds.
    if (res.status === 400 && useSchema) throw new BadSchemaError(detail);
    throw new Error(`${p.label} returned ${res.status}: ${detail}`);
  }

  const json = await res.json() as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string };
  };
  if (json.error) throw new Error(json.error.message ?? "provider error");

  return {
    text: json.choices?.[0]?.message?.content ?? "",
    tokensIn: json.usage?.prompt_tokens ?? 0,
    tokensOut: json.usage?.completion_tokens ?? 0,
    refused: json.choices?.[0]?.finish_reason === "content_filter",
  };
}

/* ---------------------------------------------------------------- Anthropic */

async function callAnthropic(p: ResolvedProvider, c: Call, useSchema: boolean): Promise<Raw> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: p.apiKey, maxRetries: 1 });
  try {
    const msg = await client.messages.create({
      model: p.model,
      max_tokens: c.maxTokens,
      system: c.system,
      output_config: {
        effort: c.effort,
        ...(useSchema && c.schema ? { format: { type: "json_schema" as const, schema: c.schema } } : {}),
      },
      messages: [{ role: "user", content: c.user }],
    });
    // A safety refusal is a 200, not a throw.
    if (msg.stop_reason === "refusal") return { text: "", tokensIn: 0, tokensOut: 0, refused: true };
    return {
      text: msg.content.filter((b) => b.type === "text").map((b) => b.text).join("\n"),
      tokensIn: msg.usage.input_tokens,
      tokensOut: msg.usage.output_tokens,
    };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new AuthError(err.message);
    if (err instanceof Anthropic.BadRequestError && useSchema) throw new BadSchemaError(err.message);
    throw err;
  }
}

/* --------------------------------------------------------------------- call */

/**
 * Six responsibilities, in order:
 *   1 hash the prompt and check the cache — cache hits make the demo instant and free
 *   2 constrain the response to a JSON schema server-side where the job has one
 *   3 parse and validate with Zod anyway; on failure retry once with the error appended
 *   4 drop the schema and retry in prose-JSON mode if the server rejects the format,
 *     so a provider with a narrower contract degrades instead of losing the feature
 *   5 log model, prompt hash, tokens and latency onto the caller's row
 *   6 hand back a clean failure so the caller can fall back deterministically
 *
 * Note what is NOT sent to Anthropic models: `temperature`. Current ones reject
 * sampling parameters outright, and a silent 400 would surface as "the AI is down"
 * in the middle of a demo. Determinism comes from the schema and the Zod gate.
 */
export async function callModel<T>(
  job: AiJob, system: string, user: string, schema: z.ZodType<T>,
): Promise<AiResult<T>> {
  const p = provider();
  const cfg = JOB[job];
  const promptText = `SYSTEM:\n${system}\n\nUSER:\n${user}`;
  // the model is part of the key: two providers must not share a cached answer
  const promptHash = createHash("sha256")
    .update(`${p?.id ?? "none"}|${p?.model ?? "none"}|${promptText}`).digest("hex");

  const [cached] = await db.select().from(aiCache).where(eq(aiCache.promptHash, promptHash)).limit(1);
  if (cached) {
    const parsed = schema.safeParse(extractJsonSafe(cached.response));
    if (parsed.success) {
      return { ok: true, data: parsed.data, source: "CACHE", model: cached.model, promptHash,
        promptText, responseText: cached.response, tokensIn: 0, tokensOut: 0, latencyMs: 0 };
    }
  }

  if (!p) return { ok: false, reason: "no model provider is configured on this instance", promptHash, promptText };

  const call: Call = { system, user, maxTokens: cfg.maxTokens, effort: cfg.effort, schema: cfg.schema, jobName: job };
  let useSchema = cfg.schema !== undefined;
  let lastError = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const started = Date.now();
    try {
      const raw = p.kind === "anthropic"
        ? await callAnthropic(p, { ...call, user: attempt === 0 ? user : retryUser(user, lastError) }, useSchema)
        : await callOpenAiShaped(p, { ...call, user: attempt === 0 ? user : retryUser(user, lastError) }, useSchema);

      if (raw.refused) return { ok: false, reason: "the model declined this request", promptHash, promptText };

      const parsed = schema.safeParse(extractJson(raw.text));
      if (!parsed.success) {
        lastError = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        continue;
      }

      await db.insert(aiCache).values({ promptHash, job, response: raw.text, model: `${p.id}/${p.model}` })
        .onConflictDoNothing();

      return { ok: true, data: parsed.data, source: "AI", model: `${p.id}/${p.model}`, promptHash,
        promptText, responseText: raw.text, tokensIn: raw.tokensIn, tokensOut: raw.tokensOut,
        latencyMs: Date.now() - started };
    } catch (err) {
      if (err instanceof AuthError) {
        return { ok: false, reason: `${p.label} rejected the API key on this instance`, promptHash, promptText };
      }
      if (err instanceof BadSchemaError && useSchema) {
        useSchema = false;          // retry once in prose-JSON mode; Zod still gates it
        lastError = err.message;
        attempt--;
        continue;
      }
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  return { ok: false, reason: lastError || "the model did not return valid output", promptHash, promptText };
}

const retryUser = (user: string, lastError: string) =>
  `${user}\n\nYour previous reply failed validation: ${lastError}\nReturn JSON only, matching the schema exactly.`;

/**
 * Borrower names never leave the process. Four lines, and the most credible thing
 * you can say to a financial-data audience.
 */
export function redact<T extends Record<string, unknown>>(obj: T): T {
  const out = { ...obj };
  for (const k of Object.keys(out)) {
    if (/borrowerName|borrower_name|obligor|customer.?name/i.test(k)) {
      (out as Record<string, unknown>)[k] = "[redacted]";
    }
  }
  return out;
}
