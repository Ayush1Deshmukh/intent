# Deployment — Vercel + Neon

Roughly fifteen minutes. Nothing here needs a paid plan.

## 1 · Database (Neon)

Create a project at [neon.tech](https://neon.tech) and copy the **pooled** connection
string. It looks like:

```
postgresql://USER:PASSWORD@ep-xxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require
```

Apply the schema and seed it from your machine, pointing at Neon:

```bash
DATABASE_URL="<neon-pooled-url>" npx drizzle-kit push
DATABASE_URL="<neon-pooled-url>" npx tsx scripts/seed.ts
```

`seed.ts` creates the three demo users, six servicers and 28 rules. The demo tape itself
is loaded through the UI in one click, so nothing else has to be prepared.

Optionally, seed the second tape — the one that has already been through review, which
beats 7 and 8 of the demo use:

```bash
DATABASE_URL="<neon-pooled-url>" npx tsx scripts/seed-review.ts
```

It takes a couple of minutes against Neon, because it works all 209 exceptions through the
real service paths rather than closing them with an UPDATE. That is the point of it.

## 2 · Push the repo

```bash
git remote add origin git@github.com:<you>/verified-tape.git
git push -u origin main
```

## 3 · Vercel

Import the repo at [vercel.com/new](https://vercel.com/new). Framework detection picks
up Next.js; the default build command (`next build`) is correct — no override needed.

Set these environment variables for **Production** (and Preview, if you want preview
deploys to work):

| Variable | Value |
|---|---|
| `DATABASE_URL` | the Neon **pooled** URL from step 1 |
| `AUTH_SECRET` | a fresh random string — `openssl rand -hex 32` |
| `DEMO_RESET_TOKEN` | any string; you'll need it to reset the demo |
| `MAX_TAPE_ROWS` | `5000` |
| `AI_ENABLED` | `true` only if you're also setting the key below |
| `ANTHROPIC_API_KEY` | your key, or leave unset |
| `ANTHROPIC_MODEL` | `claude-opus-5` |

Before deploying with AI on, run `npm run ai:check` locally against the same key. It calls
all four jobs for real and prints, per job, whether it reached the API or fell back — which
is the only way to tell the difference, because a failed call degrades silently by design.

**Do not reuse the development `AUTH_SECRET`.** It signs session JWTs.

With `AI_ENABLED` unset or `false` the whole application still works — every AI feature
has a deterministic fallback (ADR 0002), so a missing key degrades the demo rather than
breaking it.

Deploy. First build is ~2 minutes.

## 4 · Verify the deployment

```bash
curl -s https://<your-app>.vercel.app/api/openapi | head -c 200   # spec renders
curl -si https://<your-app>.vercel.app/login | head -1            # 200
```

Then log in as `operator@intain.demo` / `demo1234`, click **Load the demo tape**, confirm
the mapping, and check you get 209 exceptions.

Or drive the whole thing against the deployed instance:

```bash
BASE_URL="https://<your-app>.vercel.app" npm run ui:smoke
```

`ui:demo` is the fuller rehearsal but it reads the database directly through a local
Docker container, so it only runs against a local instance.

## 5 · Reset between demos

```bash
curl -X POST -H "x-demo-token: <DEMO_RESET_TOKEN>" \
  https://<your-app>.vercel.app/api/demo/reset
```

Truncates every table and re-seeds the reference data, so the same story can be told to
a second judge from a clean start.

## Notes

- **Use Neon's pooled URL, not the direct one.** Vercel's serverless functions open a
  connection per invocation; the direct endpoint will exhaust connections under any real
  clicking-around.
- **`scripts/tamper.ts` needs a direct database connection**, so run it locally against
  the Neon URL rather than trying to run it on Vercel:
  `DATABASE_URL="<neon-url>" npx tsx scripts/tamper.ts LN-000117 --balance 1`
  Then hit "Check integrity" in the deployed UI — that's the demo's closing beat, and it
  works fine with the script running from your laptop.
- `npx tsx scripts/tamper.ts --restore` puts every tampered value back from its sealed
  payload, so the demo is re-runnable.
