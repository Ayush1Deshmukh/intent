import { z } from "zod";

const Env = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  AUTH_SECRET: z.string().min(16, "AUTH_SECRET must be at least 16 characters"),
  // Provider-agnostic. AI_PROVIDER is one of the ids in src/lib/ai/providers.ts;
  // every one of them has a free tier that needs no credit card.
  AI_ENABLED: z.enum(["true", "false"]).optional().default("false"),
  AI_PROVIDER: z.string().optional().default(""),
  AI_API_KEY: z.string().optional().default(""),
  AI_MODEL: z.string().optional().default(""),
  AI_BASE_URL: z.string().optional().default(""),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(45000),
  DEMO_RESET_TOKEN: z.string().optional().default("demo-reset"),
  MAX_TAPE_ROWS: z.coerce.number().int().positive().optional().default(5000),
});

/**
 * Validated at first import and loud on failure. A missing key discovered during
 * a demo is unrecoverable; a missing key discovered at boot is a ten-second fix.
 */
const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = { ...parsed.data };
