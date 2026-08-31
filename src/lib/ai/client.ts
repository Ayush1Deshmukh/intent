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
 * The token budgets are a constraint, not a preference. A free tier meters tokens per
 * minute counting prompt plus requested completion — Groq's allows 8,000 — so asking
 * for 8,000 is rejected outright before the model ever runs. These jobs emit a few
 * hundred tokens of JSON; sizing for that is both correct and what makes the free
 * tier usable at all.
 *
 * `author` deliberately has no schema: its output carries a rule expression from an
 * open, recursive DSL, and pinning that into a JSON Schema would freeze the grammar
 * in two places.
 */
type JobSpec = {
  maxTokens: number;
  effort: Effort;
  schema?: Record<string, unknown>;
};

const JOB: Record<AiJob, JobSpec> = {
  explain: { maxTokens: 700, effort: "low", schema: EXPLAIN_JSON_SCHEMA },
  propose: { maxTokens: 900, effort: "medium", schema: PROPOSE_JSON_SCHEMA },
  // low effort, deliberately: this is classification, not reasoning, and at medium
  // the scratchpad ate the output budget and the server rejected an empty generation
  cluster: { maxTokens: 3500, effort: "low", schema: CLUSTER_JSON_SCHEMA },
  author: { maxTokens: 1200, effort: "medium" },
};

/** low / medium / high is the whole vocabulary the OpenAI-shaped servers accept. */
const REASONING_EFFORT: Record<Effort, "low" | "medium" | "high"> = {
  low: "low", medium: "medium", high: "high", xhigh: "high", max: "high",
};

/**
 * Why the last call fell back, on stderr, when AI_DEBUG=true.
 *
 * The whole design here is that a failed model call degrades silently to the
 * deterministic twin — which is right for a user and wrong for whoever is trying to
 * work out why the model is not answering. Without this, diagnosing a fallback meant
 * re-implementing the request by hand in a throwaway script. Twice.
 */
const debug = (job: AiJob, reason: string) => {
  if (process.env.AI_DEBUG === "true") console.error(`\x1b[2m[ai:${job}] fell back — ${reason}\x1b[0m`);
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
class TimeoutError extends Error {}

/**
 * How long to wait for a model before giving up and answering deterministically.
 *
 * `fetch` has no default timeout, so a provider that accepts the connection and then
 * stalls holds the request open indefinitely — the page spins, the user sees nothing,
 * and the deterministic twin that exists precisely for this never runs. A free tier
 * under load is exactly where that happens.
 *
 * Generous enough that a slow-but-working call still succeeds, short enough that a
 * person waiting on a screen gets an answer.
 */
const REQUEST_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? 45000);
class RateLimitError extends Error {
  constructor(message: string, readonly retryAfterMs: number | null) { super(message); }
}

/* ------------------------------------------------------------ OpenAI-shaped */

/**
 * The only transport. Groq, Gemini's compatibility endpoint, OpenRouter, Cerebras,
 * Together and a local Ollama all speak this shape. Plain fetch on purpose — a
 * provider SDK per vendor would buy nothing here and cost a dependency each.
 *
 * These accept sampling parameters, so temperature 0 is both allowed and wanted:
 * determinism here comes from temperature, the response schema and the Zod gate.
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
  // On a reasoning model this roughly halves the tokens spent on a short JSON answer,
  // which is the difference between fitting a free per-minute budget and not.
  if (p.reasoningEffort) body.reasoning_effort = REASONING_EFFORT[c.effort];
  if (useSchema && c.schema) {
    body.response_format = p.jsonSchema
      ? { type: "json_schema", json_schema: { name: c.jobName, strict: true, schema: c.schema } }
      : { type: "json_object" };
  }

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${p.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: abort.signal,
    });
  } catch (err) {
    if (abort.signal.aborted) {
      throw new TimeoutError(`${p.label} did not respond within ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 400);
    if (res.status === 401 || res.status === 403) throw new AuthError(detail);
    // 429 is "too many, wait"; 413 on these endpoints is "this one request exceeds
    // your per-minute token budget", which is a different problem with the same cure
    // only sometimes — either way, say which it was rather than reporting a number.
    if (res.status === 429 || res.status === 413) {
      const header = res.headers.get("retry-after");
      const retryAfterMs = header ? Math.min(Number(header) * 1000, 20000) : null;
      throw new RateLimitError(detail, Number.isFinite(retryAfterMs) ? retryAfterMs : null);
    }
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
 * Determinism comes from temperature 0, the response schema, and the Zod gate — never
 * from trusting the model to be consistent on its own.
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

  if (!p) {
    debug(job, "no model provider is configured on this instance");
    return { ok: false, reason: "no model provider is configured on this instance", promptHash, promptText };
  }

  const call: Call = { system, user, maxTokens: cfg.maxTokens, effort: cfg.effort, schema: cfg.schema, jobName: job };
  let useSchema = cfg.schema !== undefined;
  let lastError = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const started = Date.now();
    try {
      const raw = await callOpenAiShaped(
        p, { ...call, user: attempt === 0 ? user : retryUser(user, lastError) }, useSchema);

      if (raw.refused) {
        debug(job, "the model declined this request");
        return { ok: false, reason: "the model declined this request", promptHash, promptText };
      }

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
        debug(job, `${p.label} rejected the API key: ${err.message}`);
        return { ok: false, reason: `${p.label} rejected the API key on this instance`, promptHash, promptText };
      }
      if (err instanceof BadSchemaError && useSchema) {
        debug(job, `schema rejected, retrying in prose mode: ${err.message.slice(0, 200)}`);
        useSchema = false;          // retry once in prose-JSON mode; Zod still gates it
        lastError = err.message;
        attempt--;
        continue;
      }
      if (err instanceof TimeoutError) {
        debug(job, err.message);
        return {
          ok: false,
          reason: `${err.message}. The deterministic answer is shown instead.`,
          promptHash, promptText,
        };
      }
      if (err instanceof RateLimitError) {
        /**
         * Do not wait out a rate limit on a request someone is watching.
         *
         * This used to sleep for the server's `retry-after` — up to twenty seconds —
         * and try again. On a free tier that is a common path, not a rare one, and it
         * turned "the model is busy" into a page that hangs for the better part of a
         * minute before showing an answer the deterministic twin could have given
         * instantly. The twin exists precisely so that a busy or absent model costs
         * quality, not availability; making the user wait for the model anyway gives up
         * the only thing the fallback was for.
         *
         * A very short retry is still worth taking, because a sub-second burst limit
         * clears before anyone notices.
         */
        if (err.retryAfterMs !== null && err.retryAfterMs <= 2000 && attempt === 0) {
          await new Promise((r) => setTimeout(r, err.retryAfterMs!));
          attempt--;
          continue;
        }
        debug(job, `rate limited: ${err.message}`);
        const budget = p.freeTpm ? ` This instance is on ${p.label}'s free tier, which allows about ${p.freeTpm.toLocaleString()} tokens a minute.` : "";
        return {
          ok: false,
          reason: `${p.label} rate-limited this request.${budget} The deterministic answer is shown instead.`,
          promptHash, promptText,
        };
      }
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  debug(job, lastError || "the model did not return valid output");
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
