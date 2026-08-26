import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, aiCache } from "@/lib/db";

export type AiJob = "explain" | "propose" | "cluster" | "author";

export type AiResult<T> =
  | { ok: true; data: T; source: "AI" | "CACHE"; model: string; promptHash: string;
      promptText: string; responseText: string; tokensIn: number; tokensOut: number; latencyMs: number }
  | { ok: false; reason: string; promptHash: string; promptText: string };

const MAX_TOKENS: Record<AiJob, number> = { explain: 500, propose: 700, cluster: 1400, author: 900 };

export const aiEnabled = () =>
  process.env.AI_ENABLED === "true" && !!process.env.ANTHROPIC_API_KEY;

export const modelName = () => process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.search(/[{[]/);
  if (start === -1) throw new Error("no JSON object in the response");
  return JSON.parse(body.slice(start));
}

/**
 * Five responsibilities, in order:
 *   1 hash the prompt and check the cache — cache hits make the demo instant and free
 *   2 call with temperature 0 and a per-job token cap
 *   3 parse and validate with Zod; on failure retry once with the error appended
 *   4 log model, prompt hash, tokens and latency onto the caller's row
 *   5 hand back a clean failure so the caller can fall back deterministically
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
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  let lastError = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const started = Date.now();
    try {
      const msg = await client.messages.create({
        model: modelName(),
        max_tokens: MAX_TOKENS[job],
        temperature: 0,
        system,
        messages: [{ role: "user", content: attempt === 0 ? user : `${user}\n\nYour previous reply failed validation: ${lastError}\nReturn JSON only, matching the schema exactly.` }],
      });
      const latencyMs = Date.now() - started;
      const responseText = msg.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("\n");
      const parsed = schema.safeParse(extractJson(responseText));
      if (!parsed.success) { lastError = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "); continue; }

      await db.insert(aiCache).values({ promptHash, job, response: responseText, model: modelName() })
        .onConflictDoNothing();

      return { ok: true, data: parsed.data, source: "AI", model: modelName(), promptHash,
        promptText, responseText, tokensIn: msg.usage.input_tokens, tokensOut: msg.usage.output_tokens, latencyMs };
    } catch (err) {
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
