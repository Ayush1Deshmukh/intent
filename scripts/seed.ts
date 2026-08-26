import { seedReference, DEMO_USERS, SERVICERS } from "@/lib/seed/reference";
import { RULE_CATALOG } from "@/lib/rules/catalog";

export { seedReference };

if (process.argv[1]?.endsWith("seed.ts")) {
  seedReference()
    .then(() => { console.log(`seeded ${DEMO_USERS.length} users, ${SERVICERS.length} servicers, ${RULE_CATALOG.length} rules`); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
