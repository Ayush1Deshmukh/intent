# Verified Tape — Loan Data Verification Copilot

> The deterministic core owns the data, the AI advises, and the record proves itself.

Built for Intain's "Loan Data Verification Copilot" Full-Stack Track. Three files arrive
together — a loan tape, a servicer extract, a document manifest — and rarely agree with
each other. Verified Tape ingests all three, normalizes and validates every field
deterministically, raises (never silently resolves) cross-source conflicts, routes every
correction through a maker-checker workflow, and seals the signed-off tape into a
hash-chained, Merkle-rooted ledger that a downstream consumer can verify **without
trusting this database**.

> **Runs entirely on free tiers.** Docker locally with no accounts at all, or Vercel +
> Neon + a free model key if you want a URL. There is no paid dependency anywhere in
> this project — see [`DEPLOYMENT.md`](DEPLOYMENT.md).

## Quickstart

Everything, in one command — database included, no accounts, nothing to configure:

```bash
docker compose up --build
```

Then open **http://localhost:3000** and click any of the three roles to sign in. The
container applies its own migrations and seeds itself on first start, so there is no
separate install step. Add `SEED_REVIEWED_TAPE=true` to also build the already-reviewed
tape that beats 7 and 8 of [`DEMO.md`](DEMO.md) use.

Or run it directly, against your own Postgres:

```bash
npm install
cp .env.example .env               # set DATABASE_URL at minimum
npm run setup                      # migrations + seed, idempotent
npm run dev                        # http://localhost:3000
```

`npm run gen:tape` regenerates the demo fixtures and `docs/defects.md` from one seeded
source, if you want to change the planted defects.

Demo logins (created by `setup`, password `demo1234` for all three):

| Role | Email | Can |
|---|---|---|
| Data Operator | `operator@intain.demo` | upload, map, triage, accept proposals |
| Reviewer | `reviewer@intain.demo` | approve/reject, sign off (attest) |
| Data Consumer | `consumer@intain.demo` | read, verify, export — nothing else |

Upload `fixtures/loan_tape.csv`, `fixtures/servicer_update.csv`, and
`fixtures/document_manifest.csv` together as one tape to see the full defect set
(216 exceptions, firing 28 of the 29 rules, including 27 cross-source conflicts). `fixtures/clean_tape_50.csv`
is the zero-exception canary.

One click back to a clean demo state at any time:

```bash
curl -X POST -H "x-demo-token: $DEMO_RESET_TOKEN" http://localhost:3000/api/demo/reset
```

## Verify, test, break it

```bash
npm run test          # 140 unit tests: coercion, rules engine, hashing, the policy
                      # matrix, provider resolution, the two descriptions of every AI
                      # output schema agreeing, and the OpenAPI spec matching the routes
npm run e2e           # full pipeline against a real Postgres db, no mocks —
                      # ingest -> validate -> propose -> accept -> approve -> exclude
                      # -> attest -> verify, plus two live tamper scenarios
npm run ui:demo       # the five-minute demo, driven through a real browser as all three
                      # roles; asserts against the database, not against the screen
npm run ui:record     # records that same flow to a video file, to narrate over
npm run ai:check      # calls the model for real and reports live-vs-fallback per job
npm run ai:models     # list the models the configured key can reach
npm run demo:reviewed # build the second tape: a queue worked all the way to sign-off
                      # through the real service paths — 1108 audit events, and it verifies
npm run setup         # migrations + seed; safe to run repeatedly

npm run tamper -- LN-000117 --balance 1   # corrupt one verified record directly in SQL,
                                          # then hit /verify and watch it get named
npm run tamper -- --event 5               # or edit an audit event and break the chain
npm run tamper -- --restore               # put both back; the demo is re-runnable
```

Start here to read it: **[`SUBMISSION.md`](SUBMISSION.md)** maps every judged criterion to
something runnable, **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** is the two-page
design note, **[`DEMO.md`](DEMO.md)** is the five-minute walkthrough, and
**[`docs/AI_DEVELOPMENT_LOG.md`](docs/AI_DEVELOPMENT_LOG.md)** is how it was built with
agentic tooling and what had to be thrown away. **[`samples/`](samples/)** holds a verified
loan dataset and an audit trail this system produced, if you want to read output without
running anything.

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

Because the AI only advises, **the provider is configuration rather than architecture**.
Groq, Google Gemini, OpenRouter, Cerebras and a local Ollama all work through one
OpenAI-shaped transport, and every one of them has a free tier that needs no credit card —
**this project has no paid dependency at all.**

```bash
AI_ENABLED="true"  AI_PROVIDER="groq"  AI_API_KEY="..."   # ~30 seconds at console.groq.com/keys
npm run ai:models   # what that key can actually reach
npm run ai:check    # call all four jobs for real; reports live-vs-fallback per job
```

**Two hashes answer two different questions** (ADR 0003):

- A SHA-256 **hash chain over audit events** proves the *history* is intact — edit or
  delete any event and every link after it breaks.
- A **Merkle root over verified records** proves the *data* still matches what was
  signed — `verifyTape()` always recomputes from the live rows, never trusts a stored
  hash.

A gating exception with no defensible repair is the one case the workflow could not
absorb: a blocker cannot be waived, and inventing a value is the failure mode this whole
system exists to prevent. A reviewer **excludes the loan** instead — marked rejected,
never sealed, with the count and the reason carried in the attestation (ADR 0007).

Full rationale for each decision is in `docs/adr/0001` through `0007`.

## Stack

Next.js 15 (App Router, Server Actions) · TypeScript strict · Drizzle ORM over
`node-postgres` (ADR 0006) · PostgreSQL 16 · Zod · Decimal.js · Tailwind CSS v4 ·
Vitest. Every piece of it, including hosting (Vercel), the database (Neon) and the
model provider, runs on a free tier. Self-documenting OpenAPI 3.1 spec at `/api/openapi`, generated programmatically
from the same source-of-truth objects the app runs on (`docs` page renders it).

## Repo map

```
src/lib/canonical.ts      deterministic JSON serialization for hashing
src/lib/hash.ts           record/event hashing, Merkle tree + proofs
src/lib/coerce/           column-aware normalization (date/money/rate/state)
src/lib/rules/            the DSL, the 29-rule catalog, the interpreter
src/lib/ingest/           parsing, 4-pass header mapping, the pipeline
src/lib/service/          ingest / review / attest / preview — the write paths
src/lib/audit.ts          hash-chained event log + verifyChain()
src/lib/ai/               schemas, client (cache + fallback), the 4 AI jobs
src/lib/policy.ts         the whole RBAC matrix, one table
scripts/generate-tape.ts  deterministic fixture generator (mulberry32 seed)
scripts/e2e.ts            no-mocks acceptance test against a real database
docs/adr/                 six decisions, with what was rejected and why
```
