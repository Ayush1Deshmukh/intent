import { z } from "zod";

/** Model output is parsed against these or discarded. Never coerced into something usable. */
export const ExplainOut = z.object({
  whatTheRuleChecks: z.string().min(10).max(600),
  likelyCause: z.string().min(10).max(600),
  downstreamRisk: z.string().min(10).max(600),
});
export type ExplainOut = z.infer<typeof ExplainOut>;

export const ProposeOut = z.object({
  field: z.string().min(1),
  toValue: z.string(),
  rationale: z.string().min(5).max(600),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.object({ label: z.string().max(60), value: z.string().max(120) })).max(5).default([]),
});
export type ProposeOut = z.infer<typeof ProposeOut>;

export const ClusterOut = z.object({
  clusters: z.array(z.object({
    key: z.string().min(1).max(60),
    label: z.string().min(5).max(160),
    rootCause: z.string().min(5).max(400),
    exceptionIds: z.array(z.string()).min(1),
    suggestedAction: z.string().max(300),
    confidence: z.number().min(0).max(1),
  })).min(1).max(8),
});
export type ClusterOut = z.infer<typeof ClusterOut>;

export const AuthorOut = z.union([
  z.object({
    name: z.string().min(3).max(80),
    description: z.string().min(20).max(400),
    category: z.enum(["structural","format","range","cross_field","consistency","staleness","statistical","completeness"]),
    severity: z.enum(["BLOCKER","CRITICAL","WARNING","INFO"]),
    field: z.string().nullable().optional(),
    expected: z.string().max(160),
    expression: z.any(),
  }),
  z.object({ error: z.string().min(5).max(300) }),
]);
export type AuthorOut = z.infer<typeof AuthorOut>;

/* ------------------------------------------------------------------------- */
/* The same shapes as JSON Schema, for `output_config.format`.                */
/*                                                                            */
/* These constrain the model server-side; the Zod objects above still gate     */
/* every response afterwards. That is deliberate belt-and-braces: if these two */
/* ever drift, Zod rejects the response and the deterministic fallback runs —  */
/* the failure mode is a worse answer, never an unvalidated one. `tests/       */
/* ai-schemas.test.ts` asserts they stay in step so the drift is caught first. */
/* ------------------------------------------------------------------------- */

const str = (min: number, max: number) => ({ type: "string", minLength: min, maxLength: max });

export const EXPLAIN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["whatTheRuleChecks", "likelyCause", "downstreamRisk"],
  properties: {
    whatTheRuleChecks: str(10, 600),
    likelyCause: str(10, 600),
    downstreamRisk: str(10, 600),
  },
} as const satisfies Record<string, unknown>;

export const PROPOSE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["field", "toValue", "rationale", "confidence", "evidence"],
  properties: {
    field: { type: "string", minLength: 1 },
    toValue: { type: "string" },
    rationale: str(5, 600),
    confidence: { type: "number", minimum: 0, maximum: 1 },
    evidence: {
      type: "array", maxItems: 5,
      items: {
        type: "object", additionalProperties: false,
        required: ["label", "value"],
        properties: { label: { type: "string", maxLength: 60 }, value: { type: "string", maxLength: 120 } },
      },
    },
  },
} as const satisfies Record<string, unknown>;

export const CLUSTER_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["clusters"],
  properties: {
    clusters: {
      type: "array", minItems: 1, maxItems: 8,
      items: {
        type: "object", additionalProperties: false,
        required: ["key", "label", "rootCause", "exceptionIds", "suggestedAction", "confidence"],
        properties: {
          key: str(1, 60),
          label: str(5, 160),
          rootCause: str(5, 400),
          exceptionIds: { type: "array", minItems: 1, items: { type: "string" } },
          suggestedAction: { type: "string", maxLength: 300 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
  },
} as const satisfies Record<string, unknown>;
