import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, aiCache } from "@/lib/db";
import { EXPLAIN_JSON_SCHEMA, PROPOSE_JSON_SCHEMA, CLUSTER_JSON_SCHEMA } from "./schemas";

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

export const aiEnabled = () =>
  process.env.AI_ENABLED === "true" && !!process.env.ANTHROPIC_API_KEY;

export const modelName = () => process.env.ANTHROPIC_MODEL || "claude-opus-5";

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.search(/[{[]/);
  if (start === -1) throw new Error("no JSON object in the response");
  return JSON.parse(body.slice(start));
}

/**
 * Six responsibilities, in order:
 *   1 hash the prompt and check the cache — cache hits make the demo instant and free
 *   2 constrain the response to a JSON schema server-side where the job has one
 *   3 parse and validate with Zod anyway; on failure retry once with the error appended
 *   4 drop the schema and retry in prose-JSON mode if the server rejects the format,
 *     so a change in the structured-output contract degrades instead of failing
 *   5 log model, prompt hash, tokens and latency onto the caller's row
 *   6 hand back a clean failure so the caller can fall back deterministically
 *
 * Note what is NOT here: no `temperature`. Sampling parameters are rejected outright
 * by every current model, and a silent 400 would have shown up as "the AI is down"
 * in the middle of a demo. Determinism comes from the schema and the Zod gate.
 */
export async function callModel<T>(
  job: AiJob, system: string, user: string, schema: z.ZodType<T>,
): Promise<AiResult<T>> {
  const promptText = `SYSTEM:\n${system}\n\nUSER:\n${user}`;
  const promptHash = createHash("sha256").update(modelName() + "|" + promptText).digest("hex");

  const [cached] = await db.select().from(aiCache).where(eq(aiCache.promptHash, promptHash)).limit(1);
  if (cached) {
    const parsed = schema.safeParse(extractJsonSafe(cached.response));
    if (parsed.success) {
      return { ok: true, data: parsed.data, source: "CACHE", model: cached.model, promptHash,
        promptText, responseText: cached.response, tokensIn: 0, tokensOut: 0, latencyMs: 0 };
    }
  }

  if (!aiEnabled()) {
    return { ok: false, reason: "AI is disabled on this instance", promptHash, promptText };
  }

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 1 });
  const cfg = JOB[job];
  let useSchema = cfg.schema !== undefined;
  let lastError = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const started = Date.now();
    try {
      const msg = await client.messages.create({
        model: modelName(),
        max_tokens: cfg.maxTokens,
        system,
        output_config: {
          effort: cfg.effort,
          ...(useSchema && cfg.schema ? { format: { type: "json_schema" as const, schema: cfg.schema } } : {}),
        },
        messages: [{
          role: "user",
          content: attempt === 0
            ? user
            : `${user}\n\nYour previous reply failed validation: ${lastError}\nReturn JSON only, matching the schema exactly.`,
        }],
      });
      const latencyMs = Date.now() - started;

      // A safety refusal is a 200, not a throw. Treat it as a clean failure so the
      // deterministic fallback takes over rather than parsing an empty response.
      if (msg.stop_reason === "refusal") {
        return { ok: false, reason: "the model declined this request", promptHash, promptText };
      }

      const responseText = msg.content
        .filter((c) => c.type === "text").map((c) => c.text).join("\n");
      const parsed = schema.safeParse(extractJson(responseText));
      if (!parsed.success) {
        lastError = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        continue;
      }

      await db.insert(aiCache).values({ promptHash, job, response: responseText, model: modelName() })
        .onConflictDoNothing();

      return { ok: true, data: parsed.data, source: "AI", model: modelName(), promptHash,
        promptText, responseText, tokensIn: msg.usage.input_tokens, tokensOut: msg.usage.output_tokens, latencyMs };
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) {
        return { ok: false, reason: "the API key on this instance was rejected", promptHash, promptText };
      }
      if (err instanceof Anthropic.BadRequestError && useSchema) {
        // The server would not accept the output schema. Retry once in prose-JSON
        // mode — the Zod gate still holds, so nothing unvalidated gets through.
        useSchema = false;
        lastError = err.message;
        attempt--;
        continue;
      }
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  return { ok: false, reason: lastError || "the model did not return valid output", promptHash, promptText };
}

function extractJsonSafe(text: string): unknown {
  try { return extractJson(text); } catch { return null; }
}

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
