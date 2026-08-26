# ADR 0004 — Three data zones, three roles

**Status:** accepted

## Context

The tempting shape is one `loans` table that gets cleaned in place. It destroys the
one thing an auditor asks for: what did this value look like when it arrived, and who
changed it.

## Decision — zones

| Zone | Tables | Rule |
|---|---|---|
| 1 · Raw quarantine | `source_files`, `raw_records` | the original strings, verbatim, never mutated |
| 2 · Active working | `loan_records`, `transformations`, `exceptions`, `proposals` | typed, corrected only under maker-checker |
| 3 · Verified ledger | `verified_records`, `attestations` | sealed artifact + hash + lineage + signer |

Re-running validation deletes and rebuilds zone 2. It never touches zone 1, which is
why re-running is safe and why lineage survives it.

A `verified_records` row carries its own `payload`, its `lineage` (source file, sha256,
row number, the raw values, every rule that fired) and its `recordHash`. A downstream
system can check one against the Merkle root without trusting this database.

## Decision — roles

The problem statement names three personas, and they map cleanly onto maker-checker:

| Role | Does | Cannot |
|---|---|---|
| **Data Operator** (maker) | upload, confirm mapping, triage, accept proposals | approve, attest |
| **Reviewer** (checker) | approve or reject pending changes, sign off the tape | upload, accept |
| **Data Consumer** | read everything, verify, export | anything that writes |

`src/lib/policy.ts` is one table checked by `requireRole()` on every handler's first
line. The Data Consumer's read-only status is enforced **by absence**: no write action
lists that role, so there is no endpoint to hide.

## Consequences

`tests/policy.test.ts` asserts the full 42-cell matrix explicitly, including a test
that walks every write action and asserts the consumer is refused. A role system that
is only a hidden button is a costume; this one fails closed in the handler.
