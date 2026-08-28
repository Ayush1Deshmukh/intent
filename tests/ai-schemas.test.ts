import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ExplainOut, ProposeOut, ClusterOut,
  EXPLAIN_JSON_SCHEMA, PROPOSE_JSON_SCHEMA, CLUSTER_JSON_SCHEMA,
} from "@/lib/ai/schemas";

/**
 * Two descriptions of the same shape exist: the Zod object that gates every model
 * response, and the JSON Schema handed to the API to constrain it server-side.
 * Drift between them is silent and expensive — the server would happily produce
 * something Zod then throws away, and the feature would look like "the AI is flaky".
 *
 * These tests run the same payloads through both and demand the same verdict.
 * The JSON Schema validator below covers exactly the subset used in schemas.ts;
 * anything outside that subset throws rather than passing by default.
 */

type Json = unknown;

function validate(schema: Record<string, unknown>, value: Json, path = "$"): string[] {
  const errs: string[] = [];
  const type = schema.type as string;

  if (type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [`${path}: not an object`];
    const obj = value as Record<string, Json>;
    const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    for (const key of (schema.required as string[]) ?? []) {
      if (!(key in obj)) errs.push(`${path}.${key}: missing`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in props)) errs.push(`${path}.${key}: not allowed`);
      }
    }
    for (const [key, sub] of Object.entries(props)) {
      if (key in obj) errs.push(...validate(sub, obj[key], `${path}.${key}`));
    }
    return errs;
  }

  if (type === "array") {
    if (!Array.isArray(value)) return [`${path}: not an array`];
    if (typeof schema.minItems === "number" && value.length < schema.minItems) errs.push(`${path}: too few`);
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) errs.push(`${path}: too many`);
    const items = schema.items as Record<string, unknown> | undefined;
    if (items) value.forEach((v, i) => errs.push(...validate(items, v, `${path}[${i}]`)));
    return errs;
  }

  if (type === "string") {
    if (typeof value !== "string") return [`${path}: not a string`];
    if (typeof schema.minLength === "number" && value.length < schema.minLength) errs.push(`${path}: too short`);
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) errs.push(`${path}: too long`);
    return errs;
  }

  if (type === "number") {
    if (typeof value !== "number" || Number.isNaN(value)) return [`${path}: not a number`];
    if (typeof schema.minimum === "number" && value < schema.minimum) errs.push(`${path}: below minimum`);
    if (typeof schema.maximum === "number" && value > schema.maximum) errs.push(`${path}: above maximum`);
    return errs;
  }

  throw new Error(`the test validator does not implement type "${type}" at ${path}`);
}

const agrees = (zod: z.ZodType, json: Record<string, unknown>, value: Json) => {
  const byZod = zod.safeParse(value).success;
  const byJson = validate(json, value).length === 0;
  return { byZod, byJson, agree: byZod === byJson };
};

const sentence = (n: number) => "x".repeat(n);

describe("explain: Zod gate and JSON Schema agree", () => {
  const good = {
    whatTheRuleChecks: sentence(40),
    likelyCause: sentence(40),
    downstreamRisk: sentence(40),
  };
  const cases: [string, Json][] = [
    ["a well-formed explanation", good],
    ["a missing part", { ...good, downstreamRisk: undefined }],
    ["a part that is too short", { ...good, likelyCause: "no" }],
    ["a part that runs over the cap", { ...good, likelyCause: sentence(601) }],
    ["a number where prose belongs", { ...good, likelyCause: 42 }],
    ["not an object at all", "just a sentence"],
  ];
  for (const [name, value] of cases) {
    it(name, () => {
      const r = agrees(ExplainOut, EXPLAIN_JSON_SCHEMA, value);
      expect(r.agree, `zod=${r.byZod} jsonSchema=${r.byJson}`).toBe(true);
    });
  }
});

describe("propose: Zod gate and JSON Schema agree", () => {
  const good = {
    field: "currentBalance", toValue: "48500.00", rationale: sentence(40),
    confidence: 0.75, evidence: [{ label: "servicer", value: "48500.00" }],
  };
  const cases: [string, Json][] = [
    ["a well-formed proposal", good],
    ["confidence above one", { ...good, confidence: 1.4 }],
    ["confidence below zero", { ...good, confidence: -0.1 }],
    ["an empty field name", { ...good, field: "" }],
    ["more evidence than allowed", { ...good, evidence: Array(6).fill({ label: "a", value: "b" }) }],
    ["evidence missing its value", { ...good, evidence: [{ label: "a" }] }],
    ["a rationale over the cap", { ...good, rationale: sentence(601) }],
    ["toValue empty, meaning no defensible fix", { ...good, toValue: "", confidence: 0 }],
  ];
  for (const [name, value] of cases) {
    it(name, () => {
      const r = agrees(ProposeOut, PROPOSE_JSON_SCHEMA, value);
      expect(r.agree, `zod=${r.byZod} jsonSchema=${r.byJson}`).toBe(true);
    });
  }
});

describe("cluster: Zod gate and JSON Schema agree", () => {
  const one = {
    key: "date-format-mismatch", label: sentence(20), rootCause: sentence(60),
    exceptionIds: ["a", "b"], suggestedAction: sentence(50), confidence: 0.9,
  };
  const cases: [string, Json][] = [
    ["a single cluster", { clusters: [one] }],
    ["no clusters at all", { clusters: [] }],
    ["more clusters than allowed", { clusters: Array(9).fill(one) }],
    ["a cluster with no exception ids", { clusters: [{ ...one, exceptionIds: [] }] }],
    ["a label that is too short", { clusters: [{ ...one, label: "hi" }] }],
    ["confidence out of range", { clusters: [{ ...one, confidence: 2 }] }],
  ];
  for (const [name, value] of cases) {
    it(name, () => {
      const r = agrees(ClusterOut, CLUSTER_JSON_SCHEMA, value);
      expect(r.agree, `zod=${r.byZod} jsonSchema=${r.byJson}`).toBe(true);
    });
  }
});

describe("the JSON Schemas are shaped for structured outputs", () => {
  const all = [
    ["explain", EXPLAIN_JSON_SCHEMA],
    ["propose", PROPOSE_JSON_SCHEMA],
    ["cluster", CLUSTER_JSON_SCHEMA],
  ] as const;

  for (const [name, schema] of all) {
    it(`${name} closes every object and lists its required keys`, () => {
      const walk = (s: Record<string, unknown>, path: string) => {
        if (s.type === "object") {
          expect(s.additionalProperties, `${path} must be closed`).toBe(false);
          const props = Object.keys((s.properties ?? {}) as object);
          expect(new Set((s.required as string[]) ?? []), `${path} required`).toEqual(new Set(props));
          for (const [k, v] of Object.entries((s.properties ?? {}) as Record<string, Record<string, unknown>>)) {
            walk(v, `${path}.${k}`);
          }
        }
        if (s.type === "array" && s.items) walk(s.items as Record<string, unknown>, `${path}[]`);
      };
      walk(schema, name);
    });
  }
});
