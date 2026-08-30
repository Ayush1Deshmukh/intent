# Sample output

The deliverable the challenge asks for: a verified loan dataset and an audit trail export,
produced by this system and committed so they can be read without running anything.

These came from the demo tape — 500 rows in, 209 exceptions raised, worked through
maker-checker, 448 loans sealed and 52 excluded. Everything here is synthetic.

| File | What it is |
|---|---|
| `verified-loans.csv` | **the verified loan dataset** — all 448 sealed loans across the 26 canonical fields, each with its `version` and `recordHash` |
| `exceptions.csv` | every exception raised, with the rule, the observed value, what was expected, and how it was resolved |
| `attestation.json` | the signed Merkle root, the signer, and the leaf hashes it is computed over |
| `audit-trail.sample.jsonl` | **the audit trail** — the first 120 events of the hash chain, one JSON object per line, in `seq` order |
| `verified-records.sample.json` | 25 sealed artifacts in full: payload, lineage back to source file and row, hash, signer |
| `sources.json` | the three input files with their sha256 and row counts |
| `VERIFY.md` | how to check all of this **without this system** — the exact hash formula and leaf ordering |

Two files are samples rather than complete, and say so in their own contents:
`audit-trail.sample.jsonl` holds 120 of 1,106 events and `verified-records.sample.json`
holds 25 of 448 — the full versions are 1MB each and add nothing a reader cannot see in
the first few. `attestation.json` keeps its real root and signer with the leaf list
trimmed to 20 of 448, noted inline.

## Reading the audit trail

Each line is one event. The chain is the point:

```bash
head -3 audit-trail.sample.jsonl | python3 -m json.tool
```

`prevHash` on any event equals `hash` on the event before it. Editing or deleting any
event breaks every link after it, which `GET /api/v1/verify/{tapeId}` detects in one pass.
`VERIFY.md` gives the formula.

## Producing the complete bundle yourself

```bash
docker compose up --build          # then sign a tape off, or:
npm run demo:reviewed              # builds a tape already worked to sign-off
curl -b <session> localhost:3000/api/v1/tapes/<tapeId>/export -o export.zip
```

The Data Consumer may export; the endpoint is `GET /api/v1/tapes/{id}/export`.
