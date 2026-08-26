# ADR 0002 — The AI has no write path

**Status:** accepted

## Context

The obvious build is: an LLM reads an exception and fixes the value. It demos in a
minute and is unusable in a regulated context, because nobody can say afterwards why
a number changed, or whether a person ever agreed to it.

## Decision

The model's only output surface is a row in `proposals`. There is no function in this
codebase that takes a model response and writes a loan field. The path is:

```
Exception(OPEN)
  → proposal created                 Proposal(DRAFT)          loan untouched
  → Data Operator accepts            Proposal(ACCEPTED)       loan untouched
  → Reviewer approves                emit(CHANGE_APPROVED)    then the loan changes
```

Enforced by four things, not one:

1. `approveProposal()` is the only writer, and it is behind `requireRole("proposal:approve")`.
2. `decision.actorId !== proposal.acceptedById` — the accepter cannot approve.
3. Model output is validated against a Zod schema in `src/lib/ai/client.ts`; a parse
   failure is discarded and logged, never partially applied.
4. Every proposal records `model`, `promptHash`, tokens, latency and confidence, and
   the whole thing lands in the hash-chained audit log.

## Consequences

Every AI feature needs a **deterministic twin**, because a system that stops working
when an API is slow is not infrastructure. Explain falls back to the rule's own
description; propose falls back to a hand-written repair per rule (nine of the
twenty-eight have one); cluster falls back to grouping by rule and coercion — which on
the demo tape recovers the date cluster on its own. Author has no fallback and says so.

Building the fallbacks first turned out to be the right order: the whole system was
demonstrable before a single model call existed.
