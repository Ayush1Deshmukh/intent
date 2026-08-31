# Demo narration script

For `artifacts/video/verified-tape-demo.webm` — **3 minutes 38 seconds**, recorded at
`PACE=1.8`. Timecodes come from `artifacts/video/timings.json`, written by the run that
produced the footage, so they are exact rather than estimated.

**Delivery:** unhurried, declarative, no salesmanship. The material is strong enough that
overselling it reads as insecurity. Target **145 words per minute** — that is the pace the
word budgets below assume, and every line has been written to fit its window with air to
spare. If you speak faster, do not add words; let the pauses grow.

`[·]` = short breath, roughly 0.4s. `[··]` = full stop, roughly 1s. `[···]` = hold, ~2s,
usually while something finishes happening on screen.

For a text-to-speech tool, replace the markers with SSML breaks:
`[·]` → `<break time="400ms"/>`, `[··]` → `<break time="1s"/>`, `[···]` → `<break time="2s"/>`.

---

## 00:01 — 00:15 · The thesis
*On screen: the sign-in page. Title, three principles, the five-step pipeline.*
**30 words · 14 seconds · 129 wpm**

> Loan data arrives from systems that have never agreed on anything. [··] This turns a
> messy tape into a record you can verify [·] without trusting the database it came
> from. [···]

---

## 00:15 — 00:36 · Where the data is
*On screen: the tape overview. Counters animate: 500 rows, 216 exceptions, 68% clean,
149 gating. Then it scrolls to the three zones.*
**53 words · 21 seconds · 151 wpm**

> Three files went in — a loan tape, a servicer extract five days newer, and a document
> manifest. [·] Five hundred rows, two hundred and sixteen exceptions. [··] The raw
> strings are kept exactly as delivered and never touched again. [·] Corrections happen
> in the middle zone, under two people. [·] Only signed-off loans reach the third. [···]

---

## 00:36 — 00:58 · Root cause, not rule code
*On screen: the exception queue. "Group by root cause" is clicked; clusters appear and
scroll past.*
**55 words · 22 seconds · 150 wpm**

> Two hundred and sixteen findings, grouped by what actually went wrong. [··] Dates
> arrived in two different orderings — some rows unreadable, others read the wrong way
> round. [·] Forty-five exceptions, one cause, one decision. [··] The model names and
> merges the groups. [·] It never decides which exception belongs to which — those
> counts come from the engine. [···]

---

## 00:58 — 01:24 · One exception, end to end
*On screen: the drawer opens on a payment that doesn't amortize. Explain, then Propose a
fix, with confidence and evidence.*
**60 words · 26 seconds · 138 wpm**

> One loan. The rule, the raw value, what was expected. [··] The explanation is labelled,
> so you always know whether a model or a rule wrote it. [··] Now a proposed correction,
> with a confidence score and the arithmetic behind it. [···] And this is the part that
> matters. [·] The AI has no write path. [·] This is a proposal. [·] Accepting it does
> not touch the loan. [···]

---

## 01:24 — 01:43 · Lineage
*On screen: the records grid, then a lineage drawer — raw row, file, sha256, every
transformation.*
**42 words · 19 seconds · 133 wpm**

> Every value traces back. [·] The file it came from, its checksum, the row number, and
> the original string before anything was interpreted. [··] Every transformation applied
> on the way, every exception raised, and who decided what. [·] Nothing here is
> reconstructed after the fact. [···]

---

## 01:43 — 01:59 · The chain, made visible
*On screen: the audit chain. Coloured swatches beside each hash line up diagonally.*
**42 words · 16 seconds · 158 wpm**

> Every event carries the hash of the event before it. [··] The colour beside each hash
> is derived from the hash itself — so each row's link matches the row above. [·] Follow
> the colours down the page and you are reading the chain. [···]

---

## 01:59 — 02:16 · Maker and checker
*On screen: sign out, sign in as Reviewer, the pending change as a diff, recent decisions
below.*
**45 words · 17 seconds · 159 wpm**

> A different person now. [··] The change the operator accepted is waiting here as a
> before-and-after, with who accepted it. [··] Approving is the only action in this entire
> system that alters a loan record — and the person who accepted cannot be the person who
> approves. [···]

---

## 02:16 — 02:42 · It verifies
*On screen: the sealed tape. "Check integrity" runs both stages and passes.*
**63 words · 26 seconds · 145 wpm**

> The signed-off tape. [·] Four hundred and forty-two loans sealed, each with its hash,
> its lineage and the reviewer who signed it, under one Merkle root. [··] The check
> replays the entire event chain from the beginning and re-hashes every sealed record.
> [·] From the live rows — never from the stored hash. [··] A stored hash is a copy of
> the claim, not evidence for it. [···]

---

## 02:42 — 03:10 · Break it
*On screen: a direct SQL edit, then the check fails and names the loan — while the chain
stays intact.*
**73 words · 28 seconds · 156 wpm**

> Now someone edits a sealed balance directly in the database. [·] No API, no session, no
> audit event. [··] This is the fraud an audit log cannot see, because nothing was
> logged. [···] The check fails, and it names the loan. [··] And look at the line beneath
> it — the audit chain is still intact. [·] Every event is exactly where it was. [··] An
> audit log on its own would have told you this tape was fine. [···]

---

## 03:10 — 03:38 · Read-only, and the proof
*On screen: sign in as Data Consumer — quality score, verification history — then the API
docs.*
**72 words · 28 seconds · 154 wpm**

> The consumer sees only what was signed: a data-quality score, and every sign-off with
> the root it signed. [··] Read-only, and not by hiding buttons — there is no write
> action for this role anywhere in the policy table. [··] A single loan's Merkle proof is
> public and needs no credential. [·] Enough to verify a record you already hold, and it
> discloses nothing about any borrower. [··] The proof is public. The data is not. [···]

---

## If you need to fill to five minutes

Do not pad the narration. Record a short closing card instead, or say this over a held
final frame — it is the honest-limitations note the rubric rewards:

> Two things this does not do. [·] Re-signing a tape supersedes its previous attestation
> rather than versioning it — enough for this workflow, not enough to prove what was true
> on an arbitrary past date. [··] And a tape-level finding, like an unmapped column, has
> no single loan to attach to, so it can be waived but not excluded. [··] Everything else
> you have seen runs on free tiers, end to end, with no paid dependency.

---

## Re-recording

If you re-record, the timecodes change. Regenerate them:

```bash
npm run ai:check          # warm the cache so nothing stalls on camera
PACE=1.8 npm run ui:record
cat artifacts/video/timings.json
```

`PACE` scales every dwell. 1.8 gives 3m 38s; 2.2 gives roughly 4m 20s if you want more
room per line.
