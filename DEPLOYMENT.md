# Deployment

Two ways, both free. **If you have no hosting accounts, use the first one** — it needs
nothing but Docker, and a judge can run it on their own machine.

## Self-hosted, one command

```bash
docker compose up --build
```

`http://localhost:3000`. The container applies its own migrations and seeds itself, so
there is nothing else to run. Optional extras:

```bash
SEED_REVIEWED_TAPE=true docker compose up --build     # also build the signed-off tape
AI_ENABLED=true AI_PROVIDER=groq AI_API_KEY=gsk_... docker compose up --build
```

The database is published on `127.0.0.1:5434`, so the tools that need a real connection
work against it from the host:

```bash
npm run ui:demo                            # the whole demo, driven through a browser
npm run tamper -- LN-000001 --balance 1    # then hit "Check integrity" in the UI
npm run tamper -- --restore
```

To put it on a server, any host that runs Docker will do — Fly.io, Railway and Render all
have free or near-free tiers, and the image needs only `DATABASE_URL` and `AUTH_SECRET`.

---

# Hosted — Vercel + Neon

Roughly fifteen minutes. Nothing here needs a paid plan.

## 1 · Database (Neon)

Create a project at [neon.tech](https://neon.tech) and copy the **pooled** connection
string. It looks like:

```
postgresql://USER:PASSWORD@ep-xxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require
```

Apply the schema and seed it from your machine, pointing at Neon:

```bash
DATABASE_URL="<neon-pooled-url>" npx tsx scripts/setup.ts
```

That applies every migration in `drizzle/` that has not run yet, records it in a
`_migrations` table, and seeds the reference data. It is idempotent — run it again after
any schema change and it applies only what is new.

`seed.ts` creates the three demo users, six servicers and 29 rules. The demo tape itself
is loaded through the UI in one click, so nothing else has to be prepared.

Optionally, seed the second tape — the one that has already been through review, which
beats 7 and 8 of the demo use:

```bash
DATABASE_URL="<neon-pooled-url>" SEED_REVIEWED_TAPE=true npx tsx scripts/setup.ts
```

It takes a couple of minutes against Neon, because it works all 216 exceptions through the
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
| `AI_ENABLED` | `true` only if you're also setting a provider below |
| `AI_PROVIDER` | `groq`, `gemini`, `openrouter`, `cerebras`, or leave unset |
| `AI_API_KEY` | that provider's key |
| `AI_MODEL` | optional — each provider has a current default |

**Every provider above has a free tier that needs no credit card**, so the whole
deployment costs nothing:

| Provider | Key from | Free tier |
|---|---|---|
| Groq | [console.groq.com/keys](https://console.groq.com/keys) | ~30 req/min, 14,400/day |
| Google Gemini | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | daily caps vary by model |
| OpenRouter | [openrouter.ai/keys](https://openrouter.ai/keys) | models with a `:free` suffix |
| Cerebras | [cloud.cerebras.ai](https://cloud.cerebras.ai/) | free tier, no card |

Groq is the quickest to set up — an email address and about thirty seconds.
`ollama` also works and is completely free, but it runs locally and cannot be reached
from a serverless deployment, so it is a local-demo option only.

Before deploying with AI on, run it locally against the same key:

```bash
npm run ai:models    # what that key can actually reach — model names churn
npm run ai:check     # calls all four jobs for real, reports live-vs-fallback per job
```

That second one matters: a failed call degrades to the deterministic path **by design**,
so a broken key looks exactly like a working instance with AI switched off.

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
the mapping, and check you get 216 exceptions.

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
