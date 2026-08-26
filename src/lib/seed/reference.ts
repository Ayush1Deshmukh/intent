import { sql } from "drizzle-orm";
import { db, users, rules, servicerRefs, chainLock } from "@/lib/db";
import { RULE_CATALOG } from "@/lib/rules/catalog";
import { hashPassword } from "@/lib/auth";

export const DEMO_USERS = [
  { email: "operator@intain.demo", name: "Ada Okonjo",   role: "DATA_OPERATOR" as const },
  { email: "reviewer@intain.demo", name: "Marcus Reyes", role: "REVIEWER" as const },
  { email: "consumer@intain.demo", name: "Priya Raman",  role: "DATA_CONSUMER" as const },
];
export const DEMO_PASSWORD = "demo1234";

export const SERVICERS = [
  { id: "SVC-01", name: "Northgate Servicing" },
  { id: "SVC-02", name: "Bayline Loan Administration" },
  { id: "SVC-03", name: "Cedar Ridge Servicing" },
  { id: "SVC-04", name: "Harbor Point Asset Services" },
  { id: "SVC-05", name: "Kestrel Financial Servicing" },
  { id: "SVC-06", name: "Ironwood Portfolio Services" },
];

export async function seedReference() {
  await db.insert(chainLock).values({ id: 1 }).onConflictDoNothing();
  const pw = await hashPassword(DEMO_PASSWORD);
  for (const u of DEMO_USERS) await db.insert(users).values({ ...u, passwordHash: pw }).onConflictDoNothing();
  for (const s of SERVICERS) await db.insert(servicerRefs).values(s).onConflictDoNothing();

  const [reviewer] = await db.select({ id: users.id }).from(users).where(sql`${users.role} = 'REVIEWER'`).limit(1);
  for (const r of RULE_CATALOG) {
    await db.insert(rules).values({
      code: r.code, name: r.name, description: r.description, category: r.category,
      severity: r.severity, scope: r.scope, field: r.field, expected: r.expected,
      expression: r.expression as object, repairHint: r.repairHint ?? null,
      dependsOn: r.dependsOn ?? null, enabled: true, approvedById: reviewer?.id ?? null,
    }).onConflictDoNothing();
  }
}
