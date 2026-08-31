import { describe, expect, it } from "vitest";
import { resolveProvider, PROVIDERS, FREE_PROVIDERS } from "@/lib/ai/providers";

/**
 * Provider resolution decides whether the whole AI layer is live or running its
 * deterministic twin, and it does so from environment variables that nobody looks
 * at twice. Getting it wrong is silent in exactly the way §3.1 of the development
 * log describes, so every branch is pinned here.
 */
const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

describe("provider resolution", () => {
  it("is off unless AI_ENABLED is exactly true", () => {
    expect(resolveProvider(env({ AI_PROVIDER: "groq", AI_API_KEY: "k" }))).toBeNull();
    expect(resolveProvider(env({ AI_ENABLED: "false", AI_PROVIDER: "groq", AI_API_KEY: "k" }))).toBeNull();
    expect(resolveProvider(env({ AI_ENABLED: "TRUE", AI_PROVIDER: "groq", AI_API_KEY: "k" }))).toBeNull();
  });

  it("is off when a provider is named but the key is missing", () => {
    expect(resolveProvider(env({ AI_ENABLED: "true", AI_PROVIDER: "groq" }))).toBeNull();
    expect(resolveProvider(env({ AI_ENABLED: "true", AI_PROVIDER: "groq", AI_API_KEY: "   " }))).toBeNull();
  });

  it("resolves a free provider to its preset, with the default model", () => {
    const p = resolveProvider(env({ AI_ENABLED: "true", AI_PROVIDER: "groq", AI_API_KEY: "gsk_x" }));
    expect(p?.id).toBe("groq");
    expect(p?.kind).toBe("openai");
    expect(p?.model).toBe(PROVIDERS.groq.defaultModel);
    expect(p?.baseUrl).toBe(PROVIDERS.groq.baseUrl);
    expect(p?.apiKey).toBe("gsk_x");
  });

  it("AI_MODEL overrides the preset default", () => {
    const p = resolveProvider(env({
      AI_ENABLED: "true", AI_PROVIDER: "gemini", AI_API_KEY: "k", AI_MODEL: "gemini-2.5-flash-lite",
    }));
    expect(p?.model).toBe("gemini-2.5-flash-lite");
  });

  it("ollama needs no key, because it is local", () => {
    const p = resolveProvider(env({ AI_ENABLED: "true", AI_PROVIDER: "ollama" }));
    expect(p?.id).toBe("ollama");
    expect(p?.apiKey).toBe("");
  });

  it("a trailing slash on AI_BASE_URL does not become a double slash", () => {
    const p = resolveProvider(env({
      AI_ENABLED: "true", AI_PROVIDER: "groq", AI_API_KEY: "k",
      AI_BASE_URL: "https://example.test/v1/",
    }));
    expect(p?.baseUrl).toBe("https://example.test/v1");
  });

  it("an unknown provider id needs both a base url and a model, or it stays off", () => {
    expect(resolveProvider(env({ AI_ENABLED: "true", AI_PROVIDER: "acme", AI_API_KEY: "k" }))).toBeNull();
    expect(resolveProvider(env({
      AI_ENABLED: "true", AI_PROVIDER: "acme", AI_API_KEY: "k", AI_BASE_URL: "https://acme.test/v1",
    }))).toBeNull();
    const p = resolveProvider(env({
      AI_ENABLED: "true", AI_PROVIDER: "acme", AI_API_KEY: "k",
      AI_BASE_URL: "https://acme.test/v1", AI_MODEL: "m",
    }));
    expect(p?.kind).toBe("openai");
    expect(p?.model).toBe("m");
  });

  it("is off when AI_PROVIDER names nothing, even with a key present", () => {
    expect(resolveProvider(env({ AI_ENABLED: "true", AI_API_KEY: "k" }))).toBeNull();
  });

  it('"none" is an explicit off switch, not an unknown provider', () => {
    expect(resolveProvider(env({ AI_ENABLED: "true", AI_PROVIDER: "none", AI_API_KEY: "k" }))).toBeNull();
  });
});

describe("the provider catalogue", () => {
  it("every free provider names where to get a key and what the free tier is", () => {
    expect(FREE_PROVIDERS.length).toBeGreaterThanOrEqual(4);
    for (const p of FREE_PROVIDERS) {
      expect(p.keyUrl, p.id).toMatch(/^https:\/\//);
      expect(p.free.length, p.id).toBeGreaterThan(10);
      expect(p.defaultModel.length, p.id).toBeGreaterThan(0);
      expect(p.free.toLowerCase(), p.id).not.toContain("paid");
    }
  });

  it("every provider in the catalogue is free — the project has no paid dependency", () => {
    expect(FREE_PROVIDERS.length).toBe(Object.keys(PROVIDERS).length);
    for (const p of Object.values(PROVIDERS)) {
      expect(p.free.toLowerCase(), p.id).not.toMatch(/paid|no free tier/);
    }
  });

  it("every base url is https, except the local one", () => {
    for (const p of Object.values(PROVIDERS)) {
      if (p.id === "ollama") expect(p.baseUrl).toMatch(/^http:\/\/localhost/);
      else expect(p.baseUrl, p.id).toMatch(/^https:\/\//);
    }
  });
});
