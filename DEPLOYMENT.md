# Deployment

Two paths, both genuinely free. Neither needs a credit card at any point.

| | Time | Accounts | Gives you |
|---|---|---|---|
| **A · Docker** | 3 minutes | none | a complete instance on your machine |
| **B · Vercel + Neon** | ~15 minutes | 2 free signups | a public URL |

If you only need someone to *run* it, A is enough — the challenge accepts "hosted
deployment **or** local runnable version". Use B when you need a link to paste.

---

# A · Docker — one command, no accounts

```bash
git clone https://github.com/Ayush1Deshmukh/intent.git
cd intent
docker compose up --build
```

Open **http://localhost:3000** and click any of the three roles.

The container brings up its own PostgreSQL, applies its migrations, and seeds the demo
users, servicers and rules on first start. There is no install step to get wrong, and
running it a second time is a no-op — migrations that have already run are skipped and
the seed only inserts what is missing.

**Optional extras:**

```bash
# also build a tape already worked through review and signed off,
# which the verification and tamper steps use (~1 extra minute)
SEED_REVIEWED_TAPE=true docker compose up --build

# turn on the AI features (see "A free model key" below)
AI_ENABLED=true AI_PROVIDER=groq AI_API_KEY=gsk_... docker compose up --build
```

The database is published on `127.0.0.1:5434`, so the tools that need a real connection
work from the host:

```bash
npm install
npm run ui:demo                            # drives the whole demo through a browser
npm run tamper -- LN-000117 --balance 1    # then press "Check integrity" in the UI
npm run tamper -- --restore
```

**To stop and wipe it:** `docker compose down -v`.

---

# B · Vercel + Neon — a public URL

Vercel Hobby and Neon Free are both free indefinitely and neither asks for a card.

### 1 · Database (Neon)

Create a project at [neon.tech](https://neon.tech) and copy the **pooled** connection
string — the one with `-pooler` in the host. It looks like:

```
postgresql://USER:PASSWORD@ep-xxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require
```

> **Use the pooled URL, not the direct one.** Vercel opens a connection per invocation;
> the direct endpoint runs out of connections under any real clicking-around.

### 2 · Schema and seed data

From your machine, pointed at Neon:

```bash
git clone https://github.com/Ayush1Deshmukh/intent.git
cd intent
npm install

DATABASE_URL="<neon-pooled-url>" npx tsx scripts/setup.ts
```

That applies every migration in `drizzle/`, records each one, and seeds the three demo
users, six servicers and 29 rules. It is idempotent — safe to run again after any change.

Then add the tape that has already been through review, which the demo's verification and
tamper steps need:

```bash
DATABASE_URL="<neon-pooled-url>" SEED_REVIEWED_TAPE=true npx tsx scripts/setup.ts
```

This one takes a couple of minutes, because it works all 216 exceptions through the real
service paths rather than closing them with an `UPDATE` — which is why the resulting tape
actually verifies.

### 3 · Deploy (Vercel)

Import the repository at [vercel.com/new](https://vercel.com/new). Framework detection
picks up Next.js and the default build command is correct — override nothing.

Set these environment variables for **Production**:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the Neon **pooled** URL from step 1 |
| `AUTH_SECRET` | a fresh random string — `openssl rand -hex 32` |
| `DEMO_RESET_TOKEN` | any string; you need it to reset the demo |
| `MAX_TAPE_ROWS` | `5000` |
| `AI_ENABLED` | `true`, only if you also set the two below |
| `AI_PROVIDER` | `groq` |
| `AI_API_KEY` | a free key — see below |

**Do not reuse the development `AUTH_SECRET`.** It signs session cookies.

Deploy. The first build takes about two minutes.

### 4 · Check it

```bash
curl -si https://<your-app>.vercel.app/login | head -1        # 200
curl -s  https://<your-app>.vercel.app/api/openapi | head -c 120
```

Then sign in as `operator@intain.demo` / `demo1234`, click **Load the demo tape**, confirm
the mapping, and check you get **216 exceptions**.

You can also point the HTTP smoke test at the deployment:

```bash
BASE_URL="https://<your-app>.vercel.app" npm run ui:smoke
```

`ui:demo` is the fuller rehearsal, but it reads the database directly, so it only runs
against a local instance.

---

## A free model key

The AI features are **optional** — every one has a deterministic fallback, and the whole
system works with `AI_ENABLED=false`. To switch them on, any of these will do, and none
needs a credit card:

| Provider | Key from | Free tier |
|---|---|---|
| **Groq** — quickest | [console.groq.com/keys](https://console.groq.com/keys) | ~30 req/min, 14,400/day |
| Google Gemini | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | daily caps vary by model |
| OpenRouter | [openrouter.ai/keys](https://openrouter.ai/keys) | models with a `:free` suffix |
| Cerebras | [cloud.cerebras.ai](https://cloud.cerebras.ai/) | free tier |

Groq takes about thirty seconds and an email address. Before relying on it, run both of
these locally against the same key:

```bash
npm run ai:models    # what the key can actually reach — model names churn
npm run ai:check     # calls all four jobs for real, reports live-vs-fallback per job
```

The second one matters. A failed call degrades to the deterministic path **by design**, so
a broken key looks exactly like a working instance with AI switched off. `ai:check` is the
only thing that tells you which you have.

`ollama` also works and is completely free, but it runs locally and cannot be reached from
a serverless deployment — local demos only.

---

## Other free hosts

Any host that runs a Docker image will serve this; it needs only `DATABASE_URL` and
`AUTH_SECRET`. **Render**, **Railway** and **Koyeb** all have free or trial tiers and will
build the committed `Dockerfile` directly. Neon supplies the database in every case.

---

## Notes

- **`fixtures/` is declared in `outputFileTracingIncludes`** (`next.config.ts`). The demo
  tape loader reads those CSVs by a path built at request time, which Next's dependency
  tracing cannot follow — without that declaration the files are missing from a serverless
  build and "Load the demo tape" returns a 500, while every local and container test
  passes. `tests/packaging.test.ts` asserts the declaration is still there.

- **`scripts/tamper.ts` needs a direct database connection**, so run it from your machine
  against the Neon URL rather than on Vercel:

  ```bash
  DATABASE_URL="<neon-url>" npx tsx scripts/tamper.ts LN-000117 --balance 1
  ```

  Then press **Check integrity** in the deployed UI — that is the demo's closing beat, and
  it works fine with the script running from your laptop.
  `npx tsx scripts/tamper.ts --restore` puts everything back.

- **Reset between demos:**

  ```bash
  curl -X POST -H "x-demo-token: <DEMO_RESET_TOKEN>" https://<your-app>/api/demo/reset
  ```

  Truncates every table and re-seeds the reference data, so the same story can be told to
  a second reviewer from a clean start.
