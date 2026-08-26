# ADR 0005 — Cross-source conflicts are raised, never resolved automatically

**Status:** accepted

## Context

Three sources arrive together: the loan tape, a servicer extract, and a document
manifest. The servicer extract routinely disagrees with the tape — different unpaid
balance, different delinquency status — and its report date is often newer.

The obvious move is "newest wins". It is also how bad data becomes *verified* bad data:
a newer file is not automatically a more correct one, and once the system picks
silently, nobody downstream can tell that a choice was ever made.

## Decision

The pipeline **detects** conflicts and **raises** them. It never picks.

- A difference is material at >0.5% for money fields, and any difference at all for
  status and integer fields. Below that threshold it is rounding, not disagreement.
- Each conflict attaches to the record and fires `CON-001`, severity CRITICAL, so it
  gates sign-off.
- A `CONFLICT_DETECTED` audit event records both values and which file each came from.
- The deterministic repair for `CON-001` **proposes** adopting the newer source's value
  and says why in one sentence — but it is still a proposal, and it still needs an
  operator to accept and a reviewer to approve.

The document manifest is different in kind: it does not disagree with the tape, it
*adds* a field the tape does not carry. So `documentStatus` is derived from the
manifest's per-document columns and a missing note fires `CON-003`.

## Consequences

On the demo tape this produces 27 conflict exceptions across 32 field-level
disagreements. Every one carries both figures and both filenames, which is exactly
what a reviewer needs and exactly what "newest wins" would have thrown away.

The cost is that a tape with a stale servicer feed cannot be signed off without human
attention. That is the correct cost.
