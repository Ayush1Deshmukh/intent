# ADR 0001 — Validation rules are data, not code

**Status:** accepted

## Context

A validation engine can express rules as hand-written functions or as data the engine
interprets. Functions are quicker to write for the first ten rules and worse for
everything that comes after.

## Decision

Rules live in the `rules` table as a JSON expression in a small DSL
(`src/lib/rules/dsl.ts`). The expression **describes the violation** — it evaluates
`true` when a row is bad. `src/lib/rules/catalog.ts` is the seed, not the runtime.

## Consequences

Three things become possible that were not:

- The rule library is a **screen**, not a source file. `describeExpr()` renders any
  expression back into a sentence, so a reviewer can read what a rule does.
- A rule can be **authored from a sentence** and previewed against a real tape before
  anything is saved, because compiling to data is a much smaller target than compiling
  to code — and infinitely safer, since interpreted data cannot execute.
- Rules can be **added, disabled and versioned without a deploy**.

The cost is an interpreter to maintain and three semantics that must be written down
(null handling, decimal comparison, tape scope). That cost is paid once; the
alternative is paid on every new rule.

## Rejected

A rule as an arbitrary JS function stored as text and `eval`'d. It would have been
less code and would have handed anyone with database write access remote code
execution in a system whose entire pitch is that the database cannot be trusted.
