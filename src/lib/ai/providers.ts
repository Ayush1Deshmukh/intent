/**
 * Which model provider this instance talks to.
 *
 * The AI layer is advisory by design (ADR 0002) — it emits proposals a human has to
 * accept and a second human has to approve — so the provider behind it is a
 * configuration choice, not an architectural one. That is deliberate: it means the
 * whole system runs on a free tier, and it means a judge can run it themselves
 * without a paid account.
 *
 * Everything except Anthropic speaks the OpenAI chat-completions shape, so one HTTP
 * transport covers Groq, Google Gemini, OpenRouter, Cerebras, Together, and a local
 * Ollama or LM Studio. Nothing here is a special case in the calling code.
 */

export type ProviderKind = "openai" | "anthropic";

export type Provider = {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  /** A sensible current model. Model names churn — `npm run ai:models` lists live ones. */
  defaultModel: string;
  /** What the free tier gives you, and whether it needs a card. */
  free: string;
  keyUrl: string;
  /** Whether the server accepts `response_format: {type:"json_schema"}`. */
  jsonSchema: boolean;
  /**
   * Whether the server accepts `reasoning_effort`. On a reasoning model this is
   * the difference between a request that fits a free-tier per-minute budget and
   * one that does not — it roughly halves completion tokens on short JSON answers.
   */
  reasoningEffort: boolean;
  /**
   * Tokens-per-minute ceiling on the provider's free tier, where it is low enough
   * to matter. Requests are sized against it, and it is quoted back in the error
   * when one bounces, because "413" on its own sends you looking in the wrong place.
   */
  freeTpm?: number;
};

export const PROVIDERS: Record<string, Provider> = {
  groq: {
    id: "groq",
    label: "Groq",
    kind: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "openai/gpt-oss-120b",
    free: "free tier, no credit card — roughly 30 requests/minute and 14,400/day",
    keyUrl: "https://console.groq.com/keys",
    jsonSchema: true,
    reasoningEffort: true,
    freeTpm: 8000,
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    kind: "openai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.5-flash",
    free: "free tier, no credit card — daily request caps vary by model",
    keyUrl: "https://aistudio.google.com/apikey",
    jsonSchema: true,
    reasoningEffort: false,
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    kind: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
    free: "models with a :free suffix cost nothing; rate limits are tight",
    keyUrl: "https://openrouter.ai/keys",
    jsonSchema: false,
    reasoningEffort: false,
  },
  cerebras: {
    id: "cerebras",
    label: "Cerebras",
    kind: "openai",
    baseUrl: "https://api.cerebras.ai/v1",
    defaultModel: "llama-3.3-70b",
    free: "free tier, no credit card",
    keyUrl: "https://cloud.cerebras.ai/",
    jsonSchema: true,
    reasoningEffort: false,
  },
  ollama: {
    id: "ollama",
    label: "Ollama (local)",
    kind: "openai",
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "llama3.1:8b",
    free: "free and offline, but it will not run on a serverless deployment",
    keyUrl: "https://ollama.com/download",
    jsonSchema: false,
    reasoningEffort: false,
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com",
    defaultModel: "claude-opus-5",
    free: "paid — no free tier",
    keyUrl: "https://console.anthropic.com/settings/keys",
    jsonSchema: true,
    reasoningEffort: false,
  },
};

export const FREE_PROVIDERS = Object.values(PROVIDERS).filter((p) => p.id !== "anthropic");

export type ResolvedProvider = Provider & { apiKey: string; model: string };

/**
 * Read the environment once, and be explicit about the back-compatible case:
 * an instance configured before providers existed set ANTHROPIC_API_KEY and
 * nothing else, and it must keep working untouched.
 */
export function resolveProvider(env: NodeJS.ProcessEnv = process.env): ResolvedProvider | null {
  if (env.AI_ENABLED !== "true") return null;

  const id = (env.AI_PROVIDER || (env.ANTHROPIC_API_KEY ? "anthropic" : "")).trim().toLowerCase();
  if (!id || id === "none") return null;

  const preset = PROVIDERS[id];
  if (!preset) {
    // "custom" or an unknown id: usable, but only if the URL and model are spelled out
    if (!env.AI_BASE_URL || !env.AI_MODEL) return null;
    const apiKey = env.AI_API_KEY ?? "";
    return {
      id, label: id, kind: "openai", baseUrl: env.AI_BASE_URL.replace(/\/+$/, ""),
      defaultModel: env.AI_MODEL, free: "unknown", keyUrl: "", jsonSchema: false,
      reasoningEffort: false, apiKey, model: env.AI_MODEL,
    };
  }

  const apiKey = (env.AI_API_KEY || (preset.id === "anthropic" ? env.ANTHROPIC_API_KEY : "") || "").trim();
  // Ollama runs locally with no key at all; everything else needs one
  if (!apiKey && preset.id !== "ollama") return null;

  const model = (env.AI_MODEL || (preset.id === "anthropic" ? env.ANTHROPIC_MODEL : "") || preset.defaultModel).trim();
  const baseUrl = (env.AI_BASE_URL || preset.baseUrl).replace(/\/+$/, "");

  return { ...preset, baseUrl, apiKey, model };
}

/** For the setup message when nothing is configured — the free options, shortest first. */
export function setupHint(): string {
  return [
    "No model provider is configured, so every AI feature is running its deterministic",
    "fallback. That is a supported mode, not a broken one — but to see the model itself:",
    "",
    ...FREE_PROVIDERS.map((p) => `  ${p.id.padEnd(11)} ${p.free}\n  ${" ".repeat(11)} ${p.keyUrl}`),
    "",
    'Then in .env:  AI_ENABLED="true"  AI_PROVIDER="groq"  AI_API_KEY="..."',
  ].join("\n");
}
