# AI development log

Verified Tape was built with an agentic coding assistant (Claude Code, Opus-class
models) driving the keyboard for most of the source in this repository. This document
records how that actually went: what the assistant was good at, what it got wrong, what
was rejected and why, and what human judgement had to override.

It is deliberately not a highlight reel. The interesting content in a log like this is
the **rejected output** section, because that is the only part that demonstrates the
human is still the architect.

**Scope note, so this document is honest about its own provenance.** Everything below is
either (a) verifiable in the repository — a commit, a file, a test, a comment — or (b) an
event from a working session that produced one of those artifacts. Where a prompt is
quoted it is reconstructed to the substance of what was asked, not recovered verbatim
from a transcript; the *outcomes* are all checkable against `git log`.

---

## 1 · The standing brief: `AGENTS.md`

The single highest-leverage artifact in this repository is not code. It is
[`AGENTS.md`](../AGENTS.md), a one-page brief the assistant reads at the start of every
session. It contains five invariants stated as prohibitions:

> 1. No code path writes to `loanRecords` except `approveProposal()`.
> 2. `emit()` is called inside the same transaction as the mutation, and before it.
> 3. Model output is parsed with a Zod schema or discarded.
> 4. `recordHash` is recomputed on every write and never trusted when verifying.
> 5. Every route handler's first line is `requireRole(action)`.

This exists because of a specific, repeated failure mode. An assistant asked to "add an
endpoint that updates the loan balance" will write a perfectly good endpoint that updates
the loan balance — and quietly destroy the product's central claim, which is that exactly
one code path can do that. The model has no way to know invariant 1 unless it is written
down where it will be read every time. Codifying the invariants as *prohibitions* rather
than as descriptions turned out to matter: "records are only mutated by approval" is read
as background; "no code path writes to `loanRecords` except `approveProposal()`" is read
as a rule that can be checked against a diff.

The same file carries the two numeric rules (money stays a decimal string end to end;
comparisons go through `decimal.js`) and the three rules-engine semantics. Those three
are in the brief because each of them was gotten wrong once before it was written down.

**What this is worth:** the assistant's first draft of a new route handler now starts
with `requireRole(...)` unprompted, roughly every time. The brief did what a lint rule
cannot — it changed what "finished" means.

---

## 2 · Where AI was a genuine force multiplier

### The coercion library — tests first, deliberately

`src/lib/coerce/` is the highest bug-density code in the project, and its bugs are
silent: a date parsed the wrong way round does not throw, it produces a plausible wrong
answer that flows into three downstream rules. This was the one area where the workflow
was strictly tests-before-implementation, and the assistant was used to *generate the
adversarial cases*, which is a task it is unusually good at.

A representative prompt:

> Here is the shape of a US loan tape date column. Enumerate every way a date can arrive
> in a real servicer export and be misread — not every way it can be *invalid*, every way
> it can be **silently wrong**. Include the Excel cases.

That produced the Excel serial-date epoch trap (day 1 is 1900-01-01, but the 1900
leap-year bug means the correct epoch is 1899-12-30 — see `excelSerialToIso` in
[`src/lib/coerce/date.ts`](../src/lib/coerce/date.ts)), the leading-zero ZIP truncation,
and the DD/MM vs MM/DD ambiguity that became the demo's centrepiece defect. Enumerating
failure modes is exactly the kind of breadth task where the assistant beats a tired human
at 2am.

The *resolution* of the DD/MM ambiguity was a human decision, and a load-bearing one:
the column is resolved **once, at column level, from the distribution of values**, and
that hint is then passed to every cell (`coerceDate(raw, hint)`). Cell-by-cell guessing
is what the model proposed first, and it is wrong — it makes `03/04/2024` and
`13/04/2024` in the same column parse under different calendars.

### The rules catalogue

28 rules as data, not code ([ADR 0001](adr/0001-rules-as-data.md)). Once the DSL grammar
was fixed by hand, generating rules against it was mechanical, and the assistant produced
most of the catalogue from a description of each check plus the grammar. This is the
clearest case in the project of AI value: a well-specified, highly repetitive, easily
reviewable transformation.

Reviewing them was not mechanical. See §3.

### Fixture generation

[`scripts/generate-tape.ts`](../scripts/generate-tape.ts) is a seeded (mulberry32)
generator that emits the CSVs *and* [`docs/defects.md`](defects.md) from one source of
truth, so the answer key cannot drift from the data. The insistence on a single source
was human; the generator itself is largely assistant-written and was a big time saver.

### Boilerplate, and knowing that it is boilerplate

Route handlers, the OpenAPI object, table markup, the Tailwind theme. No insight
required, high volume, easy to check. This is where the hours actually went missing in a
good way.

---

## 3 · Rejected outputs — the part that matters

Each of these was produced by the assistant, looked reasonable, and was wrong. They are
listed in rough order of how expensive they would have been to ship.

### 3.1 The AI client could never have reached a live model

**What it wrote.** The Anthropic client sent `temperature: 0` on every request, pinned
`claude-sonnet-4-5`, and capped `max_tokens` between 500 and 1400.

**Why it is wrong.** All three are stale priors from an older API. Sampling parameters
are rejected outright by current models — `temperature` returns a 400. `max_tokens` was
sized for a world where reasoning was opt-in; it is now on by default and billed against
the same ceiling, so even a request that got through would have truncated mid-object.

**Why it was expensive.** `callModel()` catches API errors and falls back deterministically
— by design, and that design is correct. But it means this bug had *no symptom*. The app
worked. The tests passed. The UI showed rule-based explanations with the correct "no
model" provenance chip. The first time anyone would have discovered that the model was
never reachable is when a judge asked "is this actually calling Claude?" during the demo.

**How it was caught.** Not by review — by refusing to accept "the AI layer is written" as
equivalent to "the AI layer has run". Writing [`scripts/ai-check.ts`](../scripts/ai-check.ts),
whose entire job is to report live-versus-fallback *per job*, turned an invisible failure
into a printed number. Fixed in commit `ad3e0d2`.

**The transferable lesson:** a graceful fallback and a silent failure look identical from
the outside. Every fallback path in this system now has something that reports which side
of it you are on — the provenance chip in the drawer, the `source` field on every
proposal, the AI panel on `/docs`, and the live/fallback counter in `ai:check`.

**A second, larger consequence.** Being forced to look closely at the transport made it
obvious that it was hard-wired to one vendor for no architectural reason. The AI here is
advisory by construction: it emits a proposal, a human accepts, a second human approves.
Nothing downstream depends on *which* model wrote the proposal — only on the Zod gate it
has to pass. So the provider became `src/lib/ai/providers.ts`, and everything except
Anthropic now goes through one OpenAI-shaped `fetch`. That took the project's last paid
dependency to zero: Groq, Gemini, OpenRouter, Cerebras and a local Ollama all have free
tiers, and the deterministic twin still answers when a free-tier key is rate-limited.
`tests/providers.test.ts` pins every branch of the resolution, because it is config logic
that fails silently in exactly the way this section is about.

### 3.2 Clustering that was confidently, readably wrong

**What it wrote.** The root-cause clustering sent the model a 120-row sample of the
exception queue and used the row assignments it returned as the cluster membership.

**Why it is wrong.** A cause that actually affected 45 loans was reported as affecting
5 — because 5 was all the model had been shown. Every label was sensible, every
suggested action was reasonable, and the counts were nonsense.

**Why this is the worst failure in this document.** The other entries produce something
visibly broken, or something that fails closed. This produced a screen that looked
better than the deterministic version it replaced. The exception count is the number a
reviewer prioritises by; a cluster labelled "5 exceptions" gets worked after one
labelled "16", and the 45-loan problem sits untouched. Fluent output with wrong numbers
is not a degraded answer, it is an actively misleading one, and nothing in the response
would have told anyone.

**The fix was a division of labour, not a bigger sample.** The model is now handed
*buckets* the deterministic engine has already formed, each with an exact count, and
asked only to merge and name them. Membership is expanded from those buckets afterwards,
so the counts cannot be wrong — the model is never trusted with a row. It is also a much
smaller prompt (~30 lines instead of 120), which is what lets it run inside a free tier's
per-minute token budget at all.

The result is better analysis *and* true numbers: on the demo tape it collapses 209
exceptions into 7 causes, the largest holding 59 across three different rules — a merge
the per-rule grouping could not have found.

**The generalisable rule:** give the model the judgement and keep the arithmetic. That
is the same sentence as ADR 0002, arrived at a second time from a different direction.

### 3.3 Null treated as a rule violation

**What it wrote.** Range rules of the form `currentBalance < 0` and `creditScore < 300`,
evaluated with ordinary comparison.

**Why it is wrong.** In SQL and in this domain, null means *absent*, not *zero*. 110 rows
in the demo tape have a blank credit score (a planted defect, `fico-blank`). Under naive
comparison a single blank FICO fires four separate range rules, and the exception count
becomes noise — which destroys the product, because the entire value proposition is that
209 exceptions is a number a person can act on.

**The fix.** Null propagates to false through every comparison; missing values are
detected only by rules that say `isNull` explicitly. This is now semantics rule 1 in
`AGENTS.md` and is asserted in `tests/rules.test.ts`.

### 3.4 Cascading exceptions from one bad input

**What it wrote.** Every rule evaluated independently against every row.

**Why it is wrong.** A row with a garbage interest rate fails the rate range check
(correct), and then also fails the amortization check (`XFD-003`), because the amortizing
payment is *computed from that same garbage rate*. The second exception is not a finding,
it is an echo — and worse, the deterministic repair attached to it would propose a
"corrected" payment derived from a rate we already know is wrong.

**The fix.** `dependsOn` in the rule catalogue, and suppression in the engine: a rule is
skipped when a field it reads already carries a gating exception. This is semantics rule
2. It is also the difference between an exception queue and a wall of noise.

### 3.5 A hash chain that proves the wrong thing

**What it wrote.** `verifyTape()` compared each verified record's stored `recordHash`
against the Merkle root.

**Why it is wrong.** This is circular and proves nothing. If an attacker edits a loan
record, the stored hash is still the old hash, still matches the root, and verification
passes. The stored hash is not evidence; it is a copy of the claim.

**The fix.** Verification **recomputes** the hash from the live row every time and never
reads the stored one. This is invariant 4, and it is the reason `npm run tamper` produces
a visible failure instead of a green checkmark. Documented in
[ADR 0003](adr/0003-two-hashes.md).

**Worth being precise about why the model got this wrong:** it is not a knowledge gap.
The generated code was a faithful implementation of "verify the records against the root".
The specification was underdetermined and the model resolved the ambiguity in the
direction that made the code simpler. That is the characteristic failure of agentic
coding, and the only defence is a human who knows what the artifact is *for*.

### 3.6 A UI label that quietly asserted something false

**What it wrote.** The exception queue and the reviewer queue both rendered
`loanId ?? "tape-level"`.

**Why it is wrong.** Three distinct situations collapse into one label: a finding about
the whole tape (`recordId` is null), a finding about one row whose loan id happens to be
blank, and — worst — the rows reported by `STR-001`, *whose entire finding is that the
loan id is missing*. The screen said "tape-level" for a row-level defect, on the one rule
where the distinction is the point.

**How it was caught.** Not by reading the code. By an end-to-end browser test that
approved a proposal and then asserted the resulting change **in SQL**; the loan id came
back empty, which was the thread to pull. Fixed in commit `d6c115c` with a `Subject`
component that names all three cases.

### 3.7 Role refusal rendered as a server crash

**What it wrote.** `requireRolePage()` threw on an unauthorized role. The check was
correct and failed closed — the security behaviour was right.

**Why it is wrong.** The *user-visible* behaviour was Next.js's raw "server-side
exception" screen. A judge clicking around as the Data Consumer would conclude the app
had crashed, not that RBAC had worked. Correct security that reads as a bug is, in a
five-minute demo, worse than no feature.

**The fix.** A `/denied` page naming the attempted action, the role held, and the role
required — commit `19dd4c8`. It now demonstrates the RBAC rather than hiding it.

### 3.8 Two smaller ones, for completeness

- **A `lint` script that did not lint.** `package.json` carried a `lint` entry that hung
  on an interactive prompt; ESLint was never actually installed. Six months of "lint
  passes" would have been vacuous. Now configured, and clean.
- **A test that asserted the opposite of what it meant.** The demo rehearsal checked
  integrity with `!/BROKEN/i.test(text)` — which matches the word "un**broken**" in the
  success message. The test failed on a working system. Caught by reading the screenshot
  next to the failure, and it is a reminder that assistant-written *tests* deserve the
  same scepticism as assistant-written code, with less of it usually applied.

---

## 4 · The review apparatus

Reviewing generated code by reading it does not scale and does not work. Four mechanisms
carried the actual load:

**The canary fixture.** `fixtures/clean_tape_50.csv` must always produce **zero**
exceptions. It is a 50-row clean tape, and it is the single most effective test in the
project — every false positive a rule change introduces shows up as a non-zero count on
data that is known-good. `npm run dry-run` checks it in about a second.

**The pinned defect count.** The demo tape produces exactly 209 exceptions, from 27
of the 28 rules in the catalogue. That number is asserted in `scripts/e2e.ts` and in the browser test. It is a
coarse instrument, but any rule change that alters behaviour anywhere moves it, and then
a human has to decide whether the move was intended.

**No-mocks end-to-end.** `npm run e2e` runs the whole pipeline against a real Postgres —
ingest, validate, propose, accept, approve, attest, verify — plus two live tamper
scenarios. Mocked tests of a hash chain prove nothing, because the thing under test is
precisely whether the real bytes in the real database still hash to the signed root.

**Running the model for real.** `npm run ai:check` calls all four AI jobs against a live
key and reports, per job, whether it reached the API or fell back. This exists because
§3.1 and §3.2 were both invisible to every other mechanism above: the app worked, the
tests passed, and the UI honestly labelled its output — the only symptom was that the
model was never actually consulted, or was consulted and believed too far. A fallback and
a silent failure are indistinguishable unless something counts them.

**Driving the real UI.** `npm run ui:demo` runs the five-minute demo through a real
browser as three different people, and asserts the two claims that are easy to state and
hard to prove — that accepting a proposal does *not* touch the loan record, and that a
direct SQL edit to a sealed record is caught and named. Both assertions read the
database, not the screen. §3.6 was found this way and could not have been found any other
way.

---

## 5 · What the assistant was consistently bad at

- **Knowing when its own prior is stale.** §3.1 is the clean example: confident,
  well-formed, current-looking code against an API surface that had moved. There is no
  hedging in the output to signal it. The only defence is running the thing.
- **Resolving underspecification toward the simpler code.** §3.5. Ambiguity gets resolved
  silently, and always in the direction of less work.
- **Distinguishing "the check is correct" from "the experience is correct."** §3.7.
- **Answering the question it was given rather than the one that mattered.** §3.2. Asked
  to cluster a sample, it clustered the sample — correctly, fluently, and with counts that
  described the sample rather than the tape. The model was not wrong; the task was wrong,
  and nothing in a well-formed answer tells you that.
- **Holding a cross-cutting invariant without being reminded.** Every one of the five
  invariants in `AGENTS.md` is there because it was violated at least once in code that
  was locally reasonable. Locality is the model's blind spot, and a written brief is a
  cheaper fix than review.
- **Its own tests.** §3.8. A generated test that passes is weak evidence; a generated test
  that fails is worth reading twice, because it is often the test that is wrong.

## 6 · What it was consistently good at

- Enumerating failure modes and adversarial inputs — better than a human, reliably.
- Mechanical transformation against a fixed grammar, once the grammar is human-designed.
- Volume: route handlers, schemas, table markup, the OpenAPI object.
- Explaining unfamiliar territory fast enough to make a decision (Merkle proof
  construction, the Excel epoch, `numeric` round-tripping through `node-postgres`).
- Holding a consistent prose voice across README, ADRs and UI copy, which is a real
  amount of work in a project judged partly on how it reads.

## 7 · The rule that held it together

> The assistant proposes, the tests and the invariants dispose.

Which is, not by accident, the same design as the product. The AI in Verified Tape emits
a `Proposal`; a human accepts it; a different human approves it; the deterministic core
owns the data. That structure was chosen for the loan-verification domain, and then the
project was built the same way — a brief the assistant must read, a set of invariants it
cannot violate without a test going red, and a human deciding what "correct" means.

Both halves of the system rest on the same claim: an AI that advises is enormously
valuable, and an AI with a write path is a liability.
