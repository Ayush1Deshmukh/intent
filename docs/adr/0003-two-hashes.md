# ADR 0003 — Two hashes, because they answer different questions

**Status:** accepted

## Context

"Immutable audit trail" usually means an append-only table. That proves nothing: the
table is in the same database as the data, and anyone who can edit one can edit the
other. Two different attacks need two different defences.

## Decision

**A hash chain over events — proves the HISTORY is intact.**

```
hash(n) = sha256( hash(n-1) + "|" + canonicalJson(event) )        genesis = "0" × 64
```

Editing or deleting event *N* breaks every link after it, detectable in one linear
pass. `verifyChain()` also checks for gaps in `seq`, which is what a deletion looks
like. Appends are serialized through a single-row `chain_lock` taken `FOR UPDATE`:
two concurrent writers reading the same `prevHash` would fork the chain, and a forked
chain fails verification for reasons that have nothing to do with fraud.

**A Merkle root over records — proves the DATA matches what was signed.**

Each verified record hashes its 19 business fields as canonical JSON. Leaves are
**sorted ascending as hex** before pairing, so row order cannot move the root. An odd
node is **promoted unchanged, never duplicated** — duplicating enables a known
second-preimage trick.

`verifyTape()` recomputes both **from the live rows**, never from the stored hash.
Comparing a stored hash to itself proves nothing.

## Consequences

The two answer genuinely different questions, and the demo shows it:

| Attack | Chain | Data |
|---|---|---|
| `UPDATE loan_records SET current_balance = 1` | still intact | **fails**, and names the loan |
| `UPDATE audit_events SET payload = …` | **fails** at that seq | unaffected |

A leaf carries `{loanRecordId, loanId, hash}`. Keying by loan id was a real bug:
duplicate loan ids are one of the defect classes this system exists to catch, so the
verifier cannot assume they are unique. Three duplicate pairs on the demo tape showed
up as false divergences until the key changed.

## Rejected

Anchoring to a public blockchain. It adds latency, cost and an external dependency in
exchange for a property nobody in the demo can check anyway. The honest upgrade path
is an RFC 3161 timestamp over the Merkle root — one HTTP call, no chain — and it is
noted in the README as future work rather than pretended at.
