/**
 * Lists the models the configured key can actually reach.
 *
 * Every provider deprecates model names on its own schedule, so a default baked into
 * this repository will go stale. Rather than pin one and hope, this asks the provider
 * and prints what came back — paste one into AI_MODEL.
 *
 *   npm run ai:models
 */
import { provider, providerLabel } from "@/lib/ai/client";
import { setupHint, FREE_PROVIDERS } from "@/lib/ai/providers";

const line = (s = "") => console.log(s);

async function main() {
  const p = provider();
  if (!p) {
    line();
    line(setupHint());
    line();
    line("Free options, with the model each one defaults to:");
    for (const f of FREE_PROVIDERS) line(`  ${f.id.padEnd(11)} ${f.defaultModel}`);
    line();
    process.exit(1);
  }

  line(`\n${providerLabel()} · ${p.baseUrl}`);
  line(`current AI_MODEL: ${p.model}\n`);

  const res = await fetch(`${p.baseUrl}/models`, {
    headers: p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {},
  });
  if (!res.ok) {
    console.error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
    console.error("\nSome providers do not expose /models. Check their docs and set AI_MODEL by hand.");
    process.exit(1);
  }
  const json = await res.json() as { data?: { id: string; owned_by?: string }[] };
  const ids = (json.data ?? []).map((m) => m.id).sort();
  if (ids.length === 0) { line("  (the provider returned an empty list)"); process.exit(0); }
  for (const id of ids) line(`  ${id}`);
  line(`\n${ids.length} models. Put one in AI_MODEL, then run: npm run ai:check\n`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
