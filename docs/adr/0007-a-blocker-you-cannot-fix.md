# 0007 · A blocker you cannot fix

**Status:** accepted

## Context

Three severities gate sign-off differently. Warnings and info can be waived by a person,
with a written reason that lands in the audit chain. Blockers and criticals cannot be
waived at all — that is what makes them blockers, and softening it would make the
attestation meaningless.

That leaves a category the workflow had no answer for: **a gating exception with no
defensible repair.** They are not rare in the demo tape and they are not rare in reality:

- `STR-001` — the row arrived with no loan identifier. There is nothing to look it up by.
- `XFD-002` — maturity on or before origination. Both dates came from the same file with
  the same confidence; nothing in either source says which of the two is wrong.
- `RNG-004` — a negative principal. You can see that it is wrong. You cannot see what it
  should have been.

For these, every legitimate route was closed. The exception could not be waived. A
proposal needs a value, and inventing one is precisely the failure mode this system
exists to prevent. So the only way to sign off was an `UPDATE` against the database — and
both scripts that needed to reach sign-off did exactly that, with a comment admitting it
was a shortcut and not a product feature. A workflow whose own test suite has to bypass it
is not finished.

## Decision

**A reviewer can exclude a loan from the tape, with a written reason.**

The loan is marked `REJECTED`, its open exceptions close as `REJECTED`, it never enters
the verified ledger, and the excluded count with its reasons goes into the attestation
payload alongside the Merkle root.

Three constraints on it:

1. **Reviewer only.** An operator who could both propose a value *and* delete the loan
   when that value was refused would have, across those two actions, an unreviewed write
   path — the exact thing maker-checker exists to close. Excluding sits on the checker
   side.
2. **A written reason is required**, and it is not decoration: it is quoted in the
   attestation, which is what a downstream consumer reads to understand why the tape has
   448 loans and not 500.
3. **It is an audit event like any other.** `LOAN_EXCLUDED` goes into the same hash chain
   as every approval. Dropping a loan is a decision with consequences and it does not
   happen off the record.

## Why this and not the alternatives

**Let a reviewer waive blockers.** Simplest, and it destroys the product. If a blocker can
be waived then "no gating exceptions remain" means nothing, and the attestation degrades
into a signature over whatever someone was willing to sign.

**Let a reviewer edit the value directly.** This is what most systems do, and it is the
thing we are arguing against everywhere else in this codebase. A reviewer typing a
maturity date they do not know is worse than an absent loan, because the absent loan is
visible in the count and the invented date is not.

**Seal the tape with the bad loans in it and flag them.** Then the Merkle root covers
records known to be wrong, and a consumer who verifies the root has verified nothing
useful. The root has to mean "every loan under this signature passed".

**Reject the whole tape.** Proportionate for a tape that is mostly broken, and the tape
status enum still supports it. Disproportionate for 52 bad rows out of 500 — you would
throw away 448 good loans to avoid making a decision about 52.

## Consequences

- The verified ledger is a **subset** of the tape, and always was — this decision makes
  that explicit and counted rather than incidental. `attestTape()` already filtered
  ineligible records; the tape-wide gate meant that filter could never actually fire.
- Anyone reading the attestation can see how many loans were dropped and why. That number
  is itself a data-quality signal about the originator, and arguably more useful than the
  exception count.
- `scripts/e2e.ts` now reaches sign-off through this path instead of an `UPDATE`, so the
  acceptance test exercises the real workflow rather than stepping around it.
- An excluded loan is not gone. Its raw row is still in zone 1, its record is still in
  zone 2 marked `REJECTED`, and the exclusion event is in the chain. Re-signing the tape
  after a corrected file arrives is a normal operation, not a recovery.
