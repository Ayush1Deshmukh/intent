# The demo

Five minutes, ten beats, three people. Every beat below is asserted by
`npm run ui:demo`, which drives this exact sequence through a real browser and fails if
any of it stops working — so the script and the rehearsal cannot drift apart.

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

## 2 · 209 exceptions, and a number you can act on · 30s

**Operator → the tape overview.**

500 rows. 209 exceptions. 68.2% of rows clean. 149 gating exceptions blocking sign-off.

The number to defend is **209**, not 500:

> A blank credit score is one finding, not four. Null is not a violation in this engine —
> a missing value is only reported by a rule that asks for it explicitly. And a row with a
> garbage interest rate does not also get flagged for a payment that fails to amortize,
> because the amortization check is computed *from* that rate. Suppressing the echo is the
> difference between a queue and a wall of noise.

## 3 · Root cause, not rule code · 45s

**Operator → Exception queue → "Group by root cause".**

209 exceptions collapse into a handful of causes. Open the top one:

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

**Click "Propose a fix".** A proposed change appears with a before-and-after, a
confidence score, and its evidence — the principal, the term, the rate, and the payment
those three actually imply.

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

## 7 · Sign-off is refused · 20s

**Reviewer → the tape overview.** The "Verify tape" button is disabled and says why:
*N gating exceptions block sign-off.*

> Warnings can be waived, with a written reason that goes into the audit chain. Blockers
> and criticals cannot be waived at all. You clear them or you do not sign.

For the demo, either clear them by hand or use a pre-cleared tape (see *Two tapes*,
below). Then **Verify tape**.

## 8 · The artifact · 30s

494 loans sealed into the verified ledger, each with its payload, its lineage back to the
source file and row, the reviewer who signed it, and its hash. One Merkle root over all of
them, signed.

**Click "Check integrity".**

> Chain intact over 746 events, and all 494 sealed records still match the attested root.
> That number is recomputed from the live rows right now — it never reads the stored hash,
> because a stored hash is a copy of the claim, not evidence for it.

## 9 · The consumer · 25s

**Private window → `consumer@intain.demo` → Verified records.**

Read-only. Click into a loan and show the full lineage: the raw string as it arrived, the
file and row it came from, every transformation applied, every exception raised, the
proposal, who accepted it, who approved it, and the sealed payload.

Try to reach `/tapes/new` → denied.

> There is no write action for this role anywhere in the policy table. It is read-only by
> absence, not by a hidden button.

Export the verified tape. Point out the Merkle proof shipped with it:

> A downstream system can verify any single loan against the signed root offline, without
> calling this API and without trusting this database.

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

You cannot triage 137 gating exceptions on camera. The honest way to handle this is to
say so:

> I am not going to clear a hundred and forty exceptions while you watch. Here is a second
> tape that has already been through review, so you can see the sign-off and the
> verification on real data.

Judges respond well to this. Pretending otherwise is the thing that looks bad.

## If something goes wrong

| Symptom | Do this |
|---|---|
| Demo state is dirty | `curl -X POST -H "x-demo-token: $DEMO_RESET_TOKEN" <url>/api/demo/reset` |
| AI feels slow, or the venue wifi is down | Nothing. Every AI feature has a deterministic fallback and the provenance chip will honestly say "rule-based". Run `npm run ai:check` beforehand to warm the cache — responses are cached by prompt hash, so the demo clicks are instant and offline. |
| A tamper demo left the data broken | `npm run tamper -- --restore` |
| The deployed instance is unreachable | Run locally. `npm run dev` and the same nine beats work. |

## The questions you will be asked

**"Is the AI actually doing anything, or is this all rules?"**
Both, deliberately, and you can always tell which. Every explanation, proposal and cluster
carries a provenance chip. `npm run ai:check` prints, per job, whether it reached the model
or fell back. The reason the fallback exists is that a data-verification tool that stops
working when an API is down is not a data-verification tool.

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

**"Does any of this survive a hostile DBA?"**
That is beat 10. The verification recomputes from live rows and never trusts a stored
hash, so a direct SQL edit is caught and named — and the audit chain stays intact, which
proves the audit log alone would have missed it.
