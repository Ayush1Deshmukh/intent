# Architecture note

Verified Tape — Loan Data Verification Copilot. Two pages on system design, the data
model, the API, the validation engine, the AI feature, the audit trail, and what was
traded away to get them.

> **One sentence holds the whole design:** the deterministic core owns the data, the AI
> advises, and the record proves itself.

---

## 1 · System design

Next.js 15 (App Router) over PostgreSQL 16, with Drizzle as the query layer. One process
serves the UI and the API; server components read, server actions and route handlers
write. There is no separate backend service, and for a system whose whole job is to keep
one transaction honest, that is a feature — the audit event and the mutation it describes
are written by the same code in the same transaction, and no network hop can separate them.

Data moves through **three zones that are never collapsed into one table**:

```
  files ──▶  ZONE 1  raw quarantine   source_files, raw_records
             the original strings, verbatim, never mutated
                  │  confirmed column mapping
                  ▼
             ZONE 2  active working   loan_records, transformations,
             typed values             exceptions, proposals, decisions
             corrected only under maker-checker
                  │  sign-off, no gating exception open
                  ▼
             ZONE 3  verified ledger  verified_records, attestations
             sealed payload + hash + lineage + signer
```

Zone 1 is why lineage exists at all: every canonical value can be traced to a file, a
sha256, a row number and the exact string it came from. Zone 3 is why verification means
anything: it is a separate artifact, not a flag on a row, so "verified" cannot be set by
an `UPDATE`. [ADR 0004](adr/0004-three-zones-and-three-roles.md)

**Three roles, one policy table.** 15 actions × 3 roles, every cell explicit
(`src/lib/policy.ts`), enforced server-side as the first line of every route handler. The
Data Consumer is read-only *by absence* — the table lists no write action for it anywhere,
so there is no button to hide and no endpoint to forget.

**Maker-checker is enforced at the identity level, not by role alone.** `approveProposal()`
compares `acceptedById` against the current session and refuses. The person who accepted a
change cannot approve it even though both are permitted actions for their roles in general.

---

## 2 · Data model

26 canonical fields covering the challenge's example dataset in full, plus payment amount,
appraised value, ZIP and credit score. Every source column is mapped onto this schema
before anything is interpreted.

| Table | Zone | Holds |
|---|---|---|
| `tapes` | — | one ingestion batch and its lifecycle status |
| `source_files` | 1 | filename, sha256, row count, headers |
| `raw_records` | 1 | one row, verbatim, as `jsonb` + `rowHash` |
| `field_mappings` | 1→2 | header → canonical field, with method and confidence |
| `loan_records` | 2 | the canonical typed record, `version`, `recordHash` |
| `transformations` | 2 | every coercion: field, before, after, which rule |
| `rules` | 2 | the catalogue, as data |
| `exceptions` | 2 | one finding: rule, field, observed, expected, severity, status |
| `proposals` | 2 | a suggested value — from a model, a rule, or a person |
| `decisions` | 2 | accept / approve / reject, with actor and reason |
| `verified_records` | 3 | sealed payload, lineage, hash, signer |
| `attestations` | 3 | Merkle root, leaves, signer, last event seq |
| `audit_events` | — | the hash chain, append-only, across everything |

**Money and rates are `numeric` and stay decimal strings end to end.** They are never
parsed into a JS number, and rule comparisons go through `decimal.js`. A float in a money
field is a bug, not a rounding artifact.

---

## 3 · Validation engine

**28 rules stored as data, not code** — a JSON expression DSL with a specified grammar,
interpreted by `src/lib/rules/engine.ts`. Rules are rows: they can be listed, versioned,
authored from a sentence, and reasoned about without a deploy.
[ADR 0001](adr/0001-rules-as-data.md)

Three semantics do most of the work, and each was wrong once before it was written down:

1. **Null is not a violation.** Any comparison touching a null term is false; missing
   values are reported only by rules that say `isNull` explicitly. Without this, one blank
   credit score fires four range rules — and 110 rows in the demo tape have one.
2. **Dependent rules are suppressed.** A row whose interest rate already carries a gating
   exception is not also failed for a payment that does not amortize, because that check is
   computed *from* that rate. The second finding would be an echo, and its deterministic
   repair would be derived from a value already known to be wrong.
3. **Tape-scoped rules run in a second pass**, after every record is normalized — that is
   the only point at which "this column is empty across 22% of the file" can be evaluated.

The result is **209 exceptions from 500 rows**: a number a person can work, not 500 rows of
noise. `fixtures/clean_tape_50.csv` must always produce zero — it is the canary, and it is
the single most effective test in the project.

**Normalization is column-aware, not cell-by-cell.** A date column resolves to one format
from the distribution of its own values, and that decision is applied to every cell.
Guessing per cell is how `03/04/2024` and `13/04/2024` end up in different calendars.

**Cross-source conflicts are raised, never resolved.** When the servicer extract disagrees
with the tape beyond a materiality threshold, both values and both source files are
recorded and a gating exception fires. The system never picks a winner.
[ADR 0005](adr/0005-conflicts-are-raised-not-resolved.md)

---

## 4 · The AI feature

Four jobs, each with a deterministic twin: **explain** an exception, **propose** a fix,
**cluster** exceptions by root cause, **author** a rule from a sentence.

**The AI has no write path.** Every model output lands in a `proposals` row. An operator
accepts it — which changes nothing — and a *different* person approves it. That approval
is the only call in the entire API that mutates a loan value.
[ADR 0002](adr/0002-ai-proposes-only.md)

- Responses are constrained server-side by a JSON schema **and** validated with Zod. If
  they disagree, Zod wins and the deterministic twin answers.
- Every call logs model, prompt hash, tokens, latency and confidence into the **same
  hash-chained audit log** as every human decision.
- Borrower names are redacted before any payload leaves the process.
- The provider is configuration, not architecture: Groq, Gemini, OpenRouter, Cerebras and a
  local Ollama all work through one OpenAI-shaped transport, and every one has a free tier.
  **The project has no paid dependency.**

**The division of labour is the load-bearing decision.** Clustering hands the model
*buckets the engine has already formed, with exact counts*, and asks it to merge and name
them — never to assign individual rows. An earlier version did the latter and reported a
45-loan problem as a 5-loan problem, fluently. Give the model the judgement; keep the
arithmetic.

---

## 5 · Audit trail and traceability

**Two hashes, because there are two different questions.**
[ADR 0003](adr/0003-two-hashes.md)

- A **SHA-256 chain over audit events** proves the *history* is intact:
  `hash(n) = sha256(hash(n-1) ‖ canonicalJson(event))`. Edit or delete any event and every
  link after it breaks, detectable in one linear pass. Appends serialize through a
  single-row lock, because two concurrent writers reading the same `prevHash` would fork
  the chain — and a forked chain fails verification for reasons that have nothing to do
  with fraud.
- A **Merkle root over verified records** proves the *data* still matches what was signed.
  Leaves are sorted so row order cannot move the root; odd nodes are promoted, not
  duplicated.

**`verifyTape()` recomputes both from the live rows and never reads a stored hash.**
Comparing stored hashes would prove nothing: a stored hash is a copy of the claim, not
evidence for it. This is what makes `npm run tamper` produce a failure instead of a tick.

The demo's closing beat is the argument in one move: edit a sealed balance directly in SQL,
and the check fails and names the loan **while the audit chain stays intact** — an audit log
alone would have reported the tape as fine.

**The proof is public; the data is not.** `GET /api/v1/verify/{tapeId}` and a single loan's
Merkle proof need no credential — enough to verify a record you already hold, disclosing
nothing about any borrower. The sealed records themselves require a session.

---

## 6 · API design

15 tape-scoped and 7 loan-scoped endpoints, all typed, all `requireRole()`-first, all
returning RFC 7807 problem documents with a specific `type` slug and a sentence a person
can act on. OpenAPI 3.1 is generated programmatically from the same policy table and rule
catalogue the application runs on, so the spec cannot describe an app that does not exist —
and `tests/openapi.test.ts` walks the filesystem and fails if a route is undocumented, a
documented route has no file, or a write endpoint does not name its roles.

The export bundle ships `VERIFY.md`: the exact hash formula, the leaf ordering, and the
export's own result — enough to check the tape **without this system**.

---

## 7 · Trade-offs

**A hash chain and a Merkle root, not a blockchain.** Same tamper-evidence, none of the
latency or operational surface. The root is a single 64-character string; publishing it to
a timestamp authority is a small extension, not a rewrite. Explicitly out of scope per the
challenge, and the extension point is left visible rather than pretended away.

**Drizzle over an ORM with a heavier runtime.** The queries here are joins and aggregates
over a schema that must stay legible; a query builder that reads like SQL was worth more
than lazy loading. [ADR 0006](adr/0006-drizzle-over-prisma.md)

**One process, not microservices.** The invariant that an audit event and its mutation
share a transaction is cheap here and expensive across a network boundary.

**Rules as data cost a DSL and an interpreter.** A hard-coded rule is faster to write and
impossible to author from a sentence, list in the UI, or version. The DSL earns itself the
first time a rule needs to exist without a deploy.

**Sampling was rejected for cluster membership** even though it made the prompt smaller.
Correct counts matter more than a cheaper call, and the model never sees a row it might
mis-assign.

**Deliberately not built:** securitization logic, borrowing bases, yield, OCR, credit
scoring, payment workflows. All named out of scope, and every hour spent there is an hour
not spent on verification.

**Known limitations.** The demo tape is synthetic and seeded, so defect counts are exact
by construction rather than by luck. Free-tier model latency is real — a cold proposal
takes about nine seconds, which is why responses are cached by prompt hash. The tape-level
`STR-004` finding (an unmapped column) has no per-loan owner and so cannot be excluded the
way a loan can; it is waivable instead. And re-signing a tape supersedes its previous
attestation rather than versioning it — correct for this workflow, insufficient for a
system that needs to prove what was true at an arbitrary past date.
