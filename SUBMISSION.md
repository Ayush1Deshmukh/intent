# Submission map

**Verified Tape** — Loan Data Verification Copilot, Intain Full-Stack Track.

> The deterministic core owns the data. The AI advises. The record proves itself.

Every claim below points at something you can run or read. Nothing here asks to be taken
on trust, which is the same principle the product is built on.

| Start here | |
|---|---|
| Run it | [`README.md`](README.md) — five commands to a working instance |
| Watch it | [`DEMO.md`](DEMO.md) — the five-minute walkthrough, beat by beat |
| How it was built | [`docs/AI_DEVELOPMENT_LOG.md`](docs/AI_DEVELOPMENT_LOG.md) — agentic coding, including what was rejected |
| Why it is shaped this way | [`docs/adr/`](docs/adr/) — seven decisions, each with the alternatives that lost |
| Prove it works | `npm run test && npm run e2e && npm run ui:demo` |
| Run it with no accounts | `docker compose up --build` → http://localhost:3000 |

---

## The six criteria

### 1 · Data ingestion and normalization

Three files arrive together and disagree: a 500-row loan tape, a servicer extract
reported five days later, and a document manifest.

- **Headers are matched in four passes** — exact, a 168-entry alias dictionary over 19 canonical fields, fuzzy, and
  value-shape inference — and every match shows its method and confidence on the mapping
  screen for a human to confirm before anything is interpreted. `src/lib/ingest/map.ts`
- **Column-aware coercion**, not cell-by-cell guessing. A date column resolves to one
  format from the distribution of its values, then every cell is parsed under that hint —
  otherwise `03/04/2024` and `13/04/2024` in the same column parse under different
  calendars. `src/lib/coerce/`
- **The traps it absorbs silently**, all planted deliberately: rates written in decimal
  form rescaled from the column median, `$` and thousands separators, Excel serial dates
  (epoch 1899-12-30, the 1900 leap-year bug), ZIP codes with leading zeros eaten by Excel,
  a UTF-8 BOM, a header with a trailing space, and a column named `Col_17`.
  [`docs/defects.md`](docs/defects.md) is the answer key, generated from the same source
  as the fixtures so it cannot drift.
- **Cross-source conflicts are raised, never resolved.** When the servicer extract
  disagrees beyond a materiality threshold, both values and both source files are recorded
  and a gating exception fires. The system never picks a winner.
  [ADR 0005](docs/adr/0005-conflicts-are-raised-not-resolved.md)

`npm run dry-run` — parses all four fixtures and prints the exception breakdown in about a
second, no database required.

### 2 · Backend validation and exception handling

**28 rules as data, not code** — a JSON DSL with a specified grammar, interpreted by
`src/lib/rules/engine.ts`. [ADR 0001](docs/adr/0001-rules-as-data.md)

The number that matters is **209 exceptions from 500 rows**, and it is a number a person
can act on because of three semantics that are easy to get wrong:

- **Null is not a violation.** Any comparison touching a null is false; missing values are
  reported only by rules that ask for them explicitly. Without this, one blank credit score
  fires four range rules — and 110 rows in this tape have a blank credit score.
- **Dependent rules are suppressed.** A row with a bad interest rate is not also flagged
  for a payment that fails to amortize, because that check is computed *from* that rate.
  11 suppressions on this tape.
- **Tape-scoped rules run in a second pass**, after every record is normalized.

`tests/rules.test.ts` has a test named for the first of these — *"a record with every
optional field empty fires only the missing-value rules"* — that asserts fifteen rules do
**not** fire.

**Exception lifecycle:** `OPEN → PENDING_APPROVAL → RESOLVED`, or `WAIVED` (warnings only,
with a written reason), or `REJECTED`. A blocker cannot be waived; when it also has no
defensible repair the reviewer excludes the loan rather than inventing a value.
[ADR 0007](docs/adr/0007-a-blocker-you-cannot-fix.md)

### 3 · Full-stack workflows and role-based interfaces

Three roles, three genuinely different applications, one policy table — 15 actions × 3
roles, every cell explicit, asserted in `tests/policy.test.ts`. `src/lib/policy.ts`

| Role | Can | Cannot |
|---|---|---|
| Data Operator | upload, map, triage, request proposals, accept | approve anything, sign off, exclude a loan |
| Reviewer | approve or reject changes, waive, exclude a loan, sign off | upload, map, accept a proposal |
| Data Consumer | read, verify, export | **nothing else — the policy table lists no write action for this role at all** |

Enforced server-side, not in the UI. `requireRole()` is the first line of every route
handler; a refused page redirects to `/denied` naming the action, the role held and the
role required. The rehearsal asserts that a Data Consumer POSTing to a write endpoint gets
**403 from the API**, not merely a hidden button.

**Maker-checker is real and enforced at the identity level.** The person who accepts a
change cannot approve it — `approveProposal()` compares `acceptedById` against the session
and refuses with a sentence, not a code.

### 4 · Audit logs, record hashing, and traceability

**Two hashes, because there are two different questions.**
[ADR 0003](docs/adr/0003-two-hashes.md)

- A **SHA-256 chain over audit events** proves the *history* is intact:
  `hash(n) = sha256(hash(n-1) ‖ canonicalJson(event))`. Edit or delete any event and every
  link after it breaks, detectable in one linear pass. Appends serialize through a
  single-row lock so concurrent writers cannot fork the chain.
- A **Merkle root over verified records** proves the *data* still matches what was signed.
  Leaves sorted so row order cannot move the root; odd nodes promoted, not duplicated.

**The load-bearing detail:** `verifyTape()` recomputes every hash from the live rows and
never reads the stored one. Comparing stored hashes would prove nothing — a stored hash is
a copy of the claim, not evidence for it.

**Raw-to-verified lineage** is a three-zone schema that is never collapsed:

| Zone | Tables | Rule |
|---|---|---|
| 1 · Raw quarantine | `source_files`, `raw_records` | original strings, verbatim, never mutated |
| 2 · Active working | `loan_records`, `transformations`, `exceptions`, `proposals` | corrected only under maker-checker |
| 3 · Verified ledger | `verified_records`, `attestations` | sealed artifact + hash + lineage + signer |

Click any loan and the lineage drawer shows the raw row as it arrived, its file and sha256
and row number, every coercion applied, every exception raised, the proposal, who accepted
it, who approved it, and the sealed payload. `GET /api/v1/records/{id}/lineage`

**Try to break it:**

```bash
npm run tamper -- LN-000001 --balance 1   # direct SQL edit to a sealed record
npm run tamper -- --event 5               # edit an audit event in place
npm run tamper -- --restore               # put both back
```

The first is caught and the loan is **named**, while the audit chain stays intact — which
is the whole point: an audit log alone would have reported everything fine. The second
breaks the chain and names event 5 as the first bad link.

### 5 · AI-assisted review and agentic coding discipline

**Four AI jobs**, each with a deterministic twin: explain an exception, propose a fix,
cluster exceptions by root cause, and compile an analyst's sentence into a validation rule.

**The AI has no write path.** Every model output lands in a `proposals` row. An operator
accepts it; a *different* person approves it; only then does a loan record change.
[ADR 0002](docs/adr/0002-ai-proposes-only.md)

- Responses are constrained server-side by a JSON schema **and** validated with Zod —
  `tests/ai-schemas.test.ts` runs 20 payloads through both descriptions and fails if they
  ever disagree. Output that fails the gate is discarded, never coerced.
- Every call logs model, prompt hash, tokens, latency and confidence into the **same
  hash-chained audit log** as everything else.
- Borrower names are redacted before any payload leaves the process.
- Every feature has a deterministic fallback, and the whole system is demonstrable with
  `AI_ENABLED=false`. The provenance chip in the UI always says which one you are looking
  at — a graceful fallback and a silent failure otherwise look identical.

**Verified live**, not just written: all four jobs reach Groq (`openai/gpt-oss-120b`, free
tier) and pass their Zod gate. `npm run ai:check` calls the model for real and reports, per
job, whether it reached the API or fell back. Successful responses are cached by prompt hash, so the demo is instant
and works offline.

**The provider is pluggable, and every supported one is free.** Because the AI only
advises, which model answers is a configuration line: Groq, Google Gemini, OpenRouter,
Cerebras and a local Ollama all work through one OpenAI-shaped transport
(`src/lib/ai/providers.ts`), and none of them needs a credit card. Anthropic is supported
and is the only paid option. **This project has no paid dependency** — hosting, database
and model all sit on free tiers, so a judge can stand the whole thing up themselves.

**Agentic coding discipline:** [`docs/AI_DEVELOPMENT_LOG.md`](docs/AI_DEVELOPMENT_LOG.md).
It covers the standing brief in [`AGENTS.md`](AGENTS.md) that encodes five invariants as
prohibitions, where the assistant was a genuine multiplier, the review apparatus that
carried the load — and eight **rejected outputs** with the reasoning that overrode them —
including one (`temperature: 0` against a model that rejects it) that would have made the
AI silently unreachable during the demo with no error anywhere, and one where the
clustering read better than its replacement while reporting a 45-loan problem as a
5-loan problem.

### 6 · API design, deployment, and demo readiness

- **15 documented endpoints**, all typed, all `requireRole()`-first, all returning RFC 7807
  problem documents with a specific `type` slug and a sentence a person can act on.
- **OpenAPI 3.1 generated programmatically** from the same policy table and rule catalogue
  the app runs on, so the spec cannot describe an app that does not exist.
  `GET /api/openapi`, rendered at `/docs`.
- `GET /api/v1/verify/{tapeId}` is **public and unauthenticated by design** — anyone can
  check a tape, nobody can change it.
- The export bundle ships `VERIFY.md`: the exact hash formula, the leaf ordering, and the
  export's own verification result, so a third party can check the tape **without this
  system**.
- **Deployment:** two paths, both free — [`DEPLOYMENT.md`](DEPLOYMENT.md). `docker compose
  up --build` gives a complete working instance with no accounts at all: the container
  applies its own migrations and seeds itself, so there is no install step to get wrong.
  Vercel + Neon is the hosted path, about fifteen minutes.
- **Demo readiness:** [`DEMO.md`](DEMO.md) is the script, and `npm run ui:demo` drives that
  exact sequence through a real browser as all three roles, asserting against the database
  rather than the screen. The script and the rehearsal cannot drift apart.

---

## Cost

Zero, deliberately, and it is a design property rather than a corner cut. Vercel hobby,
Neon free, and any of the free model providers. The AI is advisory (ADR 0002), which is
what makes the provider swappable in the first place — and every AI feature has a
deterministic twin, so even a rate-limited free key degrades the prose rather than the
product.

## What we deliberately did not build

Named here because scope discipline is a decision, not an omission.

- **No securitization logic.** No waterfalls, no borrowing bases, no yield. Explicitly out
  of scope, and every hour spent there is an hour not spent on verification.
- **No blockchain.** A hash chain plus a Merkle root gives the same tamper-evidence with
  none of the latency or operational surface. The root is a single 64-character string;
  publishing it to a timestamp authority is a small extension, not a rewrite.
- **No custom models.** Foundation models through an API, with deterministic fallbacks.
- **No silent auto-resolution.** The system never picks a winner between two disagreeing
  sources, and never applies an AI suggestion without two humans.

## Verification, top to bottom

```bash
npm run lint          # clean
npm run test          # 113 unit tests
npm run dry-run       # parse the fixtures, print the defect breakdown, check the canary
npm run e2e           # the whole pipeline against a real database, no mocks, plus tampers
npm run ui:demo       # the five-minute demo through a real browser, all three roles
npm run ai:check      # call the model for real, report live-vs-fallback per job
```

`fixtures/clean_tape_50.csv` must always produce **zero** exceptions. It is the canary, and
it is the single most effective test in the project: every false positive a rule change
introduces shows up immediately on data known to be good.
