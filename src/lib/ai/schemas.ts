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
