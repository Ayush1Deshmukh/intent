# Verified Tape — Loan Data Verification Copilot

> The deterministic core owns the data, the AI advises, and the record proves itself.

Built for Intain's "Loan Data Verification Copilot" Full-Stack Track. Three files arrive
together — a loan tape, a servicer extract, a document manifest — and rarely agree with
each other. Verified Tape ingests all three, normalizes and validates every field
deterministically, raises (never silently resolves) cross-source conflicts, routes every
correction through a maker-checker workflow, and seals the signed-off tape into a
hash-chained, Merkle-rooted ledger that a downstream consumer can verify **without
trusting this database**.

## Quickstart

```bash
npm install
cp .env.example .env               # fill in DATABASE_URL at minimum
npm run db:push                    # apply the schema (drizzle-kit push)
npm run db:seed                    # 3 demo users, 6 servicers, 28 rules
npm run gen:tape                   # regenerate the demo fixtures + docs/defects.md
npm run dev                        # http://localhost:3000
```

Demo logins (seeded by `db:seed`, password `demo1234` for all three):

| Role | Email | Can |
|---|---|---|
| Data Operator | `operator@intain.demo` | upload, map, triage, accept proposals |
| Reviewer | `reviewer@intain.demo` | approve/reject, sign off (attest) |
| Data Consumer | `consumer@intain.demo` | read, verify, export — nothing else |

Upload `fixtures/loan_tape.csv`, `fixtures/servicer_update.csv`, and
`fixtures/document_manifest.csv` together as one tape to see the full defect set
(209 exceptions across 28 rules, 32 cross-source conflicts). `fixtures/clean_tape_50.csv`
is the zero-exception canary.

One click back to a clean demo state at any time:

```bash
curl -X POST -H "x-demo-token: $DEMO_RESET_TOKEN" http://localhost:3000/api/demo/reset
```

## Verify, test, break it

```bash
npm run test    # 89 unit tests: coercion, rules engine, hashing, policy matrix
npm run e2e     # full pipeline against a real Postgres db, no mocks —
                # ingest -> validate -> propose -> review -> attest -> verify,
                # plus two live tamper scenarios (edited balance, edited audit event)
npm run tamper -- LN-000117 --balance 1   # corrupt one verified record directly in SQL,
                                           # then hit /verify and watch it get named
```

## Architecture in one page

**Three zones, never collapsed into one table** (ADR 0004):

| Zone | Tables | Rule |
|---|---|---|
| 1 · Raw quarantine | `source_files`, `raw_records` | original strings, verbatim, never mutated |
| 2 · Active working | `loan_records`, `transformations`, `exceptions`, `proposals` | typed, corrected only under maker-checker |
| 3 · Verified ledger | `verified_records`, `attestations` | sealed artifact + hash + lineage + signer |

**Rules are data, not code.** `src/lib/rules/catalog.ts` holds 28 rule definitions as a
JSON DSL (`src/lib/rules/dsl.ts`); `engine.ts` interprets them and suppresses dependent
rules whose input field already carries a gating exception, so one bad interest rate
doesn't cascade into a second, nonsensical exception.

**Conflicts are raised, never resolved** (ADR 0005). When the servicer extract disagrees
with the tape beyond a materiality threshold, the pipeline records both values, both
source files, and fires a gating exception — it never picks a winner.

**The AI has no write path** (ADR 0002). Every model output lands in `proposals`, never
directly in `loan_records`; an operator must accept it and a *different* person must
approve it before the loan record changes. Every AI call is Zod-validated, cached by
prompt hash, and logged (model, tokens, latency, confidence) into the same hash-chained
audit log. Every AI feature has a deterministic fallback and the system is fully
demonstrable with `AI_ENABLED=false`.

**Two hashes answer two different questions** (ADR 0003):

- A SHA-256 **hash chain over audit events** proves the *history* is intact — edit or
  delete any event and every link after it breaks.
- A **Merkle root over verified records** proves the *data* still matches what was
  signed — `verifyTape()` always recomputes from the live rows, never trusts a stored
  hash.

Full rationale for each decision is in `docs/adr/0001` through `0006`.

## Stack

Next.js 15 (App Router, Server Actions) · TypeScript strict · Drizzle ORM over
`node-postgres` (ADR 0006) · PostgreSQL 16 · Zod · Decimal.js · Tailwind CSS v4 ·
Vitest. Self-documenting OpenAPI 3.1 spec at `/api/openapi`, generated programmatically
from the same source-of-truth objects the app runs on (`docs` page renders it).

## Repo map

```
src/lib/canonical.ts      deterministic JSON serialization for hashing
src/lib/hash.ts           record/event hashing, Merkle tree + proofs
src/lib/coerce/           column-aware normalization (date/money/rate/state)
src/lib/rules/            the DSL, the 28-rule catalog, the interpreter
src/lib/ingest/           parsing, 4-pass header mapping, the pipeline
src/lib/service/          ingest / review / attest / preview — the write paths
src/lib/audit.ts          hash-chained event log + verifyChain()
src/lib/ai/               schemas, client (cache + fallback), the 4 AI jobs
src/lib/policy.ts         the whole RBAC matrix, one table
scripts/generate-tape.ts  deterministic fixture generator (mulberry32 seed)
scripts/e2e.ts            no-mocks acceptance test against a real database
docs/adr/                 six decisions, with what was rejected and why
```
