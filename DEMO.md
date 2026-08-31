# The demo

Five minutes, ten beats, three people. Every beat below is asserted by
`npm run ui:demo`, which drives this exact sequence through a real browser and fails if
any of it stops working — so the script and the rehearsal cannot drift apart.

## Narrating it

[`docs/NARRATION.md`](docs/NARRATION.md) is a word-for-word script keyed to the recording's
real timecodes, with pause markers and a measured words-per-minute budget per beat. Read it
aloud over the video, or feed it to a text-to-speech tool — the pause markers map directly
to SSML breaks.

## Recording it

```bash
npm run ai:check        # warm the model cache, so nothing stalls on camera
npm run ui:record       # ~4 minutes → artifacts/video/verified-tape-demo.webm
```

That drives the real application through the same ten beats below, in the same order,
at a pace you can talk over. It has no audio and makes no argument — narrate it from this
document, or use it as b-roll and present live. It restores the record it tampers with,
so the instance is left usable.

`PACE=1.5 npm run ui:record` slows every dwell if you speak deliberately.

## Before you start

```bash
npm run db:seed          # or: curl -X POST -H "x-demo-token: $DEMO_RESET_TOKEN" <url>/api/demo/reset
npm run dev
```

Two browser windows, side by side, logged in as different people:

| Window | Who | Email | Password |
|---|---|---|---|
| left | Ada Okonjo, **Data Operator** | `operator@intain.demo` | `demo1234` |
| right | Marcus Reyes, **Reviewer** | `reviewer@intain.demo` | `demo1234` |

A third login, `consumer@intain.demo`, is the read-only Data Consumer. Open it in a
private window when you get to beat 9.

Have a terminal open and visible. You will use it once, at the end, and it is the best
thirty seconds of the demo.

---

## The line to open with

> Loan data arrives from four systems that have never agreed on anything. Every platform
> downstream of it is only as good as that tape. This system takes a messy tape and turns
> it into a record you can verify **without trusting the database it came from**.

Then, if you say nothing else, say this:

> The deterministic core owns the data. The AI advises. The record proves itself.

---

## 1 · Three files that disagree · 40s

**Operator window → Tapes → "Load the demo tape".**

Three files land together: a loan tape (500 rows), a servicer extract (124 loans,
reported five days later), and a document manifest (492 loans). This is what actually
shows up — not one clean CSV.

You arrive on the **mapping screen**. Point at two things:

- The headers are real-world ugly: `Curr Bal ` with a trailing space, `Orig Bal ($)`,
  a UTF-8 BOM on the first column, and `Col_17` — a column with no name a person would
  recognise. Each one shows what it matched to and how confident the match was.
- `Col_17` was inferred from the **shape of its values**, not its name. `Notes` is
  correctly left unmapped — free text is not a canonical field, and guessing would be
  worse than asking.

> Nothing has been written to the working tables yet. The raw strings are already stored
> verbatim, and they stay that way forever — but a human confirms the mapping before
> anything is interpreted.

**Click Confirm.** It takes about twenty seconds; talk through the next paragraph while
it runs.

## 2 · 216 exceptions, and a number you can act on · 30s

**Operator → the tape overview.**

500 rows. 216 exceptions. 68.4% of rows clean. 149 gating exceptions blocking sign-off.

The number to defend is **216**, not 500:

> A blank credit score is one finding, not four. Null is not a violation in this engine —
> a missing value is only reported by a rule that asks for it explicitly. And a row with a
> garbage interest rate does not also get flagged for a payment that fails to amortize,
> because the amortization check is computed *from* that rate. Suppressing the echo is the
> difference between a queue and a wall of noise.

## 3 · Root cause, not rule code · 45s

**Operator → Exception queue → "Group by root cause".**

216 exceptions collapse into a handful of causes. Open the top one:

> **Dates arrived in two different orderings.** The origination column contains both DD/MM
> and MM/DD values. Some rows cannot be read at all; others were read the wrong way round,
> which then breaks the term and maturity checks downstream.

This is the beat that separates the product from a validation script. Say why it is hard:

> There is no single format that reads this column correctly, because two servicers wrote
> into it. One decision here resolves forty-five exceptions. Finding that is worth more
> than explaining any one of them.

Click **Show these** to filter the queue to that cluster, then clear it.

## 4 · One exception, end to end · 60s

Filter the rule dropdown to **XFD-003 — payment does not amortize**. Open a row.

The drawer shows the raw value as it arrived, the normalized value, the rule, and what
the rule expected.

**Click Explain.** Three parts come back: what the rule checks, the likely cause for
*this* row, and what goes wrong downstream if it is left. Point at the chip:

> That chip says whether a model wrote this or a rule did. You can always tell.

**Click "Propose a fix".** This one takes a few seconds with a cold cache — about nine
on a free tier, measured — and the panel says what it is doing while you wait. Use them:
that is the moment to say the next sentence, not after.

A proposed change appears with a before-and-after, a confidence score, and its evidence —
the principal, the term, the rate, and the payment those three actually imply.

Now say the most important sentence in the demo:

> The AI has no write path. This is a proposal. Accepting it does not touch the loan
> record.

**Click Accept.** Read the confirmation out loud: it is now a *pending change* waiting
for a Reviewer.

## 5 · Maker is not checker · 20s

Still in the operator window, click **Review queue** in the nav.

You get `/denied`, naming the action, the role you hold, and the role required.

> The person who accepted a change cannot approve it. That is not a UI convention — the
> API returns 403 for this role too. There is no hidden button.

## 6 · The reviewer approves · 40s

**Reviewer window → Review queue.**

The pending change is there as a diff: old value struck through, new value in green, the
rationale, the evidence, the confidence, and **who accepted it**.

**Click "Approve and apply".**

> That was the only action in this entire system that alters a loan record. It writes the
> audit event first, in the same transaction, so the event exists even if the write fails
> — and the write can never exist without the event.

Note the record version has gone to v2 and its hash has changed.

## 7 · Sign-off is refused, and the one honest way out · 45s

**Reviewer → the tape overview.** The "Verify tape" button is disabled and says why:
*N gating exceptions block sign-off.*

> Warnings can be waived, with a written reason that goes into the audit chain. Blockers
> and criticals cannot be waived at all.

Which raises the obvious question, so answer it before it is asked. **Exception queue →
filter to XFD-002, maturity on or before origination → Open.**

There is no "Propose a fix" here — the reviewer does not make changes. And this one has
no defensible repair anyway: the tape says the loan matures before it was funded, and
neither source can say which of the two dates is wrong.

Point at the red panel:

> A blocker can't be waived and this one can't be fixed. So the loan gets dropped from
> the tape, not guessed at. It's marked rejected, it never enters the verified ledger,
> and the count and my reason go into the attestation — which is what actually happens in
> loan review. Bad loans get kicked.

Type a reason (the button stays disabled until you do) and **Exclude this loan**.

> That wrote a `LOAN_EXCLUDED` event into the same hash chain as everything else. Nothing
> in this system, including dropping a loan, happens off the record.

For the demo, switch to the pre-reviewed tape here (see *Two tapes*, below). Then
**Verify tape**.

## 8 · The artifact · 30s

442 loans sealed into the verified ledger — 500 rows in, 58 excluded — each with its
payload, its lineage back to the source file and row, the reviewer who signed it, and its
hash. One Merkle root over all of them, signed.

**Click "Check integrity".**

> Chain intact over 1108 events, and all 442 sealed records still match the attested root.
> That root is recomputed from the live rows right now — it never reads the stored hash,
> because a stored hash is a copy of the claim, not evidence for it.

## 9 · The consumer · 25s

**Private window → `consumer@intain.demo` → Verified records.**

Read-only. Click into a loan and show the full lineage: the raw string as it arrived, the
file and row it came from, every transformation applied, every exception raised, the
proposal, who accepted it, who approved it, and the sealed payload.

Try to reach `/tapes/new` → denied.

> There is no write action for this role anywhere in the policy table. It is read-only by
> absence, not by a hidden button.

Export the verified tape. It is a zip, and the thing to open is `VERIFY.md`:

> That file tells you how to check this tape without this system — the exact hash formula
> for the event chain, the leaf ordering for the Merkle root, and this export's own result.
> `attestation.json` carries the signed root and every leaf, so a downstream platform can
> recompute it offline. And there is a per-loan proof endpoint that needs no credential at
> all: `GET /api/v1/verified/{tapeId}?loanId=LN-000117` returns the record hash, its Merkle
> path and the signed root — enough to verify a loan you already hold, and nothing about
> any borrower. The sealed record itself needs a session. The proof is public; the data is
> not.

## 10 · Break it, live · 40s

**Terminal, on camera:**

```bash
npm run tamper -- LN-000001 --balance 1
```

> That is a direct `UPDATE` against the database. No API, no session, no audit event.
> This is the attack an audit log cannot see, because nothing was logged.

**Back to the browser → Check integrity.**

The check now **fails**, and names `LN-000001`: the stored loan no longer matches the
value that was signed off. And note the second line:

> The audit chain is still intact. Every event is exactly where it was. An audit log alone
> would have told you everything was fine.

Then, if there is time, corrupt an audit event instead:

```bash
npm run tamper -- --event 5
```

Now the chain itself breaks, and the check names event 5 as the first bad link.

**Close on:**

> Two hashes, because there are two different questions. The chain proves the history is
> intact. The Merkle root proves the data still matches what was signed. You need both,
> and neither of them requires you to trust me.

```bash
npm run tamper -- --restore     # puts everything back, so you can demo again
```

---

## Two tapes, and saying so

You cannot triage 149 gating exceptions on camera. Set up the second tape before you
start:

```bash
npm run demo:reviewed
```

That builds **Q2 2026 acquisition tape — signed off**: the same 500 rows, worked all the
way through. And it is worth saying exactly how, because it is not a shortcut:

> This one has already been through review — 79 exceptions repaired under maker-checker,
> 62 waived with written reasons, 58 loans excluded. Not by editing the database: every
> one of those went through the same service calls you just watched me click, by the same
> two people, writing 1108 audit events. That is why it verifies.

Then say the honest thing:

> I'm not going to clear a hundred and fifty exceptions while you watch.

Judges respond well to this. Pretending otherwise is what looks bad.

## If something goes wrong

| Symptom | Do this |
|---|---|
| Demo state is dirty | `curl -X POST -H "x-demo-token: $DEMO_RESET_TOKEN" <url>/api/demo/reset` |
| AI feels slow on the first click | Expected, and worth pre-empting: run `npm run ai:check` before the demo. Responses are cached by prompt hash, so the clicks you rehearse return instantly. Cold, explain takes about a second and propose about nine. |
| The free tier rate-limits you, or the venue wifi is down | Nothing. Every AI feature has a deterministic fallback and the provenance chip will honestly say "rule-based". Run `npm run ai:check` beforehand to warm the cache — responses are cached by prompt hash, so the demo clicks are instant and offline. |
| A tamper demo left the data broken | `npm run tamper -- --restore` |
| The deployed instance is unreachable | Run locally. `npm run dev` and the same nine beats work. |

## The questions you will be asked

**"Is the AI actually doing anything, or is this all rules?"**
Both, deliberately, and you can always tell which. Every explanation, proposal and cluster
carries a provenance chip, and `/docs` names the provider and model currently answering.
`npm run ai:check` prints, per job, whether it reached the model or fell back. The reason
the fallback exists is that a data-verification tool that stops working when an API is
down is not a data-verification tool.

**"Which model is this, and what does it cost to run?"**
Nothing. Because the AI only advises, the provider is a configuration line — Groq, Gemini,
OpenRouter, Cerebras and a local Ollama all work through one transport, and all of them
have a free tier with no credit card. Hosting is Vercel hobby and the database is Neon
free. There is no paid dependency anywhere in the project.

**"Why not let the AI fix the data directly?"**
Because then the audit trail says a model changed a balance and nobody can say why. Model
output lands in a `proposals` row; an operator accepts it; a *different* person approves
it. That is the only write path to a loan record. [ADR 0002](docs/adr/0002-ai-proposes-only.md).

**"Why not blockchain?"**
A hash chain plus a Merkle root gives the same tamper-evidence with none of the latency
and none of the operational surface. If you want a public anchor, publishing the single
64-character root to a timestamp authority is the extension — the root is already computed
and already signed. [ADR 0003](docs/adr/0003-two-hashes.md).

**"What happens when the servicer file and the tape disagree?"**
The system records both values, both source files, and raises a gating exception. It never
picks a winner. The AI will *recommend* the servicer figure when its report date is newer,
and show you both dates — but a human decides. [ADR 0005](docs/adr/0005-conflicts-are-raised-not-resolved.md).

**"What if a blocker can't be fixed at all?"**
The reviewer drops the loan from the tape, with a written reason, and it never enters the
verified ledger. That is beat 7. The alternative — letting someone waive a blocker, or
edit the value directly — is the thing this whole system is built to prevent.

**"Does any of this survive a hostile DBA?"**
That is beat 10. The verification recomputes from live rows and never trusts a stored
hash, so a direct SQL edit is caught and named — and the audit chain stays intact, which
proves the audit log alone would have missed it.
