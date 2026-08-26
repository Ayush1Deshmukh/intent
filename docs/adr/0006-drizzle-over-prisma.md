# ADR 0006 — Drizzle ORM instead of Prisma

**Status:** accepted · superseded the original plan

## Context

The build plan specified Prisma. Prisma downloads platform-specific engine binaries
from `binaries.prisma.sh` at install and generate time. In the build environment that
host returned 403, so `prisma generate` could not complete and no work could proceed.

## Decision

Drizzle ORM over `node-postgres`.

## Consequences

The forced change turned out to be the better choice for this particular system:

- **`numeric` columns come back as exact decimal strings.** Prisma hands back a
  `Decimal` object that must be serialized before hashing; Drizzle hands back
  `"412000.00"` — already the exact form `canonicalJson` needs. Since the entire
  integrity story rests on money never becoming a float, the shorter path is the safer
  one. See ADR 0003.
- **No binary to fetch at build time**, which matters for a serverless deploy as much
  as it mattered here.
- **The schema is TypeScript**, so `$inferSelect` types flow into the service layer
  without a codegen step.

What was given up: Prisma's nested-write API and its migration tooling. Migrations are
a single generated SQL file applied with `psql`, which is enough for a system with one
schema version. `db.transaction()` covers every place a nested write would have been
used, and the audit invariant requires an explicit transaction anyway.
