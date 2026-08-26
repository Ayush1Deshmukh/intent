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

`seed.ts` creates the three demo users, six servicers and 28 rules. Nothing else needs
to be loaded ahead of time — the demo tape is uploaded through the UI.

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
| `ANTHROPIC_MODEL` | `claude-sonnet-4-5` |

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

Then log in as `operator@intain.demo` / `demo1234`, upload the three files from
`fixtures/`, and confirm you get 209 exceptions.

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
