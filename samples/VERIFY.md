# Verifying Q2 2026 acquisition tape — signed off without this system

Exported 2026-08-30T18:12:30.156Z by consumer@intain.demo.

## 1. The event chain

`audit.jsonl` is ordered by `seq`. For each event compute

    hash = sha256( prevHash + "|" + canonicalJson({seq, createdAt, actorId, actorRole,
                                                   action, entityType, entityId, payload}) )

where the first event's `prevHash` is 64 zeros. Canonical JSON means: object keys sorted
lexicographically and recursively, `null` emitted explicitly, no whitespace. Every computed
hash must equal the stored `hash`, and each event's `prevHash` must equal the previous
event's `hash`. A gap in `seq` means an event was deleted.

## 2. The data

`attestation.json` carries the signed Merkle root and one leaf per sealed record.
Re-hash each record in `clean.csv` over its 19 business fields — money at 2 decimal places,
rates at 4, dates as `YYYY-MM-DD` — sort the leaf hashes ascending as hex, and combine
pairwise with `sha256(left + right)`, promoting any odd node unchanged. The result must
equal `merkleRoot`.

## 3. This export's own result

```json
{
  "ok": true,
  "attested": true,
  "chain": {
    "ok": true,
    "eventsChecked": 1106,
    "firstBadSeq": null,
    "reason": null
  },
  "data": {
    "ok": true,
    "attestedRoot": "5f7afc59d9fb8086d738edd2e91cc045ff10efa2f513aadd1071e8a4452be629",
    "recomputedRoot": "5f7afc59d9fb8086d738edd2e91cc045ff10efa2f513aadd1071e8a4452be629",
    "recordCount": 448,
    "divergences": []
  },
  "checkedAt": "2026-08-30T18:12:29.794Z"
}
```

Chain: intact over 1106 events
Data: matches the attested root
