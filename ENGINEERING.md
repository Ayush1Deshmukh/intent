# Engineering brief — read this before changing anything

Verified Tape is a loan data verification copilot. One sentence holds the whole design:

> **The deterministic core owns the data, the AI advises, and the record proves itself.**

## The five invariants

These are not style preferences. Breaking one breaks the product's central claim.

1. **No code path writes a loan's *values* except `approveProposal()`** in
   `src/lib/service/review.ts`. Ingest creates records; `excludeLoan()` may set
   `verificationStatus` to `REJECTED` and nothing else. No other mutation exists.
2. **`emit()` is called inside the same transaction as the mutation, and before it.**
   The audit event exists even if the write fails; the write never exists without the event.
3. **Model output is parsed with a Zod schema or discarded.** Never coerced, never
   partially trusted. See `src/lib/ai/client.ts`.
4. **`recordHash` is recomputed on every write and never trusted when verifying.**
   `verifyTape()` re-hashes the live row; comparing stored hashes would prove nothing.
5. **Every route handler's first line is `requireRole(action)`.** No ad-hoc role checks.

## Two rules about numbers

- Money and rates are `numeric` columns and come back from pg as **exact decimal strings**.
  They stay strings all the way to `canonicalJson`. A float in a money field is a bug.
- Rule comparisons go through `decimal.js`, never JS `<`. Tolerances are explicit
  constants in the rule expression, never implicit float slack.

## Three semantics in the rules engine

- **Null is not a violation.** Any comparison touching a null term is false. Missing-value
  rules say `isNull` explicitly. Without this, one blank FICO fires four range rules.
- **Dependent rules are suppressed** when an input field already carries a gating
  exception (`dependsOn` in the catalog). One bad rate should not also produce a bogus
  amortization repair derived from that same rate.
- **Tape-scoped rules** run in a second pass, after every record is normalized.

## The three data zones

| Zone | Tables | Rule |
|---|---|---|
| 1 · Raw quarantine | `source_files`, `raw_records` | verbatim, never mutated, never deleted while the tape lives |
| 2 · Active working | `loan_records`, `transformations`, `exceptions`, `proposals` | corrected only under maker-checker |
| 3 · Verified ledger | `verified_records`, `attestations` | sealed artifacts; rewritten only by a new sign-off |

## Conventions

- Server components read; **server actions and route handlers write**. UI never calls
  the database directly for a mutation.
- Errors are `HttpProblem` (RFC 7807) with a specific `type` slug and a sentence a
  person can act on. Not `"Forbidden"`.
- Tests come before implementation for anything that parses external data. The coercion
  library is the highest bug-density code here and its bugs are silent.
- `fixtures/clean_tape_50.csv` must always produce **zero** exceptions. It is the canary;
  run `npm run e2e` after any rules change.

## Commands

```
npm run dev            # localhost:3000
npm run gen:tape       # regenerate fixtures + docs/defects.md from one source of truth
npm run db:seed        # users, servicers, 29 rules
npm run test           # unit: coercion, rules, hashing, policy
npm run e2e            # full pipeline against a real database, including the tamper checks
npm run tamper -- LN-000117 --balance 1     # the demo's last thirty seconds
npm run tamper -- --restore                # put it back
npm run ui:demo        # the whole demo through a real browser, all three roles
npm run ai:check       # call the model for real; reports live-vs-fallback per job
npm run demo:reviewed  # a second tape, worked to sign-off through the real service paths
```

## Two things that are easy to get wrong

- **A gating exception cannot be waived.** When there is no defensible repair the reviewer
  calls `excludeLoan()` — the loan is dropped from the tape with a written reason, not
  given an invented value. ADR 0007. Never add a waive path for BLOCKER or CRITICAL.
- **The model provider is pluggable, and must stay that way.** `src/lib/ai/providers.ts`
  holds the catalogue; every provider speaks the OpenAI chat-completions shape through
  one transport, and every one has a free tier. The point is that the project has no
  paid dependency — do not add code that assumes a specific vendor above `callModel()`.
- **Determinism in the AI layer comes from `temperature: 0`, the response schema and
  the Zod gate** — never from trusting the model to be consistent. `callModel()` falls
  back silently on any failure, so a broken request looks like "the AI is off" rather
  than an error; that is why `ai:check` counts live-versus-fallback per job.
