import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db, auditEvents, users, attestations } from "@/lib/db";
import { requireRolePage } from "@/lib/auth";
import IntegrityPanel from "../integrity";

export const dynamic = "force-dynamic";

const ACTION_TONE: Record<string, string> = {
  FILE_INGESTED: "bg-accentsoft text-accent",
  MAPPING_PROPOSED: "bg-surface2 text-muted",
  MAPPING_CONFIRMED: "bg-accentsoft text-accent",
  VALUE_COERCED: "bg-surface2 text-muted",
  CONFLICT_DETECTED: "bg-warnsoft text-warn",
  RULES_RUN: "bg-accentsoft text-accent",
  EXCEPTION_RAISED: "bg-critsoft text-crit",
  AI_PROPOSAL_CREATED: "bg-brasssoft text-brass",
  PROPOSAL_ACCEPTED: "bg-brasssoft text-brass",
  CHANGE_APPROVED: "bg-oksoft text-ok",
  CHANGE_REJECTED: "bg-critsoft text-crit",
  EXCEPTION_WAIVED: "bg-warnsoft text-warn",
  TAPE_ATTESTED: "bg-oksoft text-ok",
};

/**
 * A hash chain is only convincing if you can see it. Truncated hex in two columns
 * is not seeing it — nobody compares `4f0986b938…` by eye down a page.
 *
 * So each hash gets a colour swatch derived from its own first bytes. The swatch
 * beside an event's `prev` is necessarily the same colour as the swatch beside the
 * previous event's `hash`, all the way down, and a reader gets the structure at a
 * glance instead of taking it on faith. It is a rendering of the data, not a
 * decoration: two different hashes cannot produce the same swatch by accident often
 * enough to matter over a screenful, and the full values are in the title attribute.
 */
function Swatch({ hash }: { hash: string }) {
  const hue = parseInt(hash.slice(0, 3), 16) % 360;
  const sat = 42 + (parseInt(hash.slice(3, 5), 16) % 26);
  return (
    <span
      className="inline-block h-2.5 w-2.5 rounded-sm shrink-0 align-middle border border-black/10"
      style={{ background: `hsl(${hue} ${sat}% 62%)` }}
      aria-hidden
    />
  );
}

export default async function AuditPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ action?: string }>;
}) {
  await requireRolePage("audit:read");
  const { id } = await params;
  const { action } = await searchParams;

  const rows = await db.select({ e: auditEvents, actor: users.email })
    .from(auditEvents).leftJoin(users, eq(users.id, auditEvents.actorId))
    .where(eq(auditEvents.tapeId, id)).orderBy(asc(auditEvents.seq));

  const [att] = await db.select().from(attestations).where(eq(attestations.tapeId, id)).limit(1);
  const shown = action ? rows.filter((r) => r.e.action === action) : rows;
  const actions = [...new Set(rows.map((r) => r.e.action))];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1 rise">
        <Link href={`/tapes/${id}`} className="eyebrow no-underline">← Tape</Link>
        <h1 className="text-2xl font-semibold">Audit chain</h1>
        <p className="text-sm text-ink2 max-w-prose">
          Every event carries the hash of the event before it, so removing or editing any one of
          them breaks every link after it. {rows.length} events on this tape.
        </p>
        <p className="text-xs text-muted max-w-prose">
          The swatch beside each hash is derived from the hash itself, so an event&rsquo;s
          &ldquo;links back to&rdquo; colour always matches the &ldquo;this event&rdquo; colour of the
          row above. Follow the colours down the page and you are reading the chain.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px] items-start">
        <div className="flex flex-col gap-3">
          <div className="card p-3 flex flex-wrap gap-1.5 items-center">
            <span className="eyebrow mr-1">Action</span>
            <Link href={`/tapes/${id}/audit`} className={`chip no-underline ${!action ? "bg-accentsoft text-accent" : "bg-surface2 text-muted"}`}>all</Link>
            {actions.map((a) => (
              <Link key={a} href={`/tapes/${id}/audit?action=${a}`}
                className={`chip no-underline ${action === a ? "bg-accentsoft text-accent" : "bg-surface2 text-muted"}`}>
                {a.toLowerCase().replace(/_/g, " ")}
              </Link>
            ))}
          </div>

          <div className="card overflow-hidden">
            <div className="max-h-[68vh] overflow-auto">
              <table className="dtable">
                <thead><tr>
                  <th className="tnum">Seq</th><th>Action</th><th>Actor</th><th>Entity</th>
                  <th title="the hash of the event before this one">Links back to</th>
                  <th title="sha256 of this event, including the hash above">This event</th>
                </tr></thead>
                <tbody>
                  {shown.slice(0, 500).map((r) => (
                    <tr key={r.e.id}>
                      <td className="tnum mono text-xs">{r.e.seq}</td>
                      <td><span className={`chip ${ACTION_TONE[r.e.action] ?? "bg-surface2 text-muted"}`}>{r.e.action.toLowerCase().replace(/_/g, " ")}</span></td>
                      <td className="text-xs text-muted">{r.actor ?? "system"}</td>
                      <td className="mono text-[0.68rem] text-muted">{r.e.entityType}</td>
                      <td className="mono text-[0.62rem] text-muted whitespace-nowrap" title={r.e.prevHash}>
                        <span className="inline-flex items-center gap-1.5"><Swatch hash={r.e.prevHash} />{r.e.prevHash.slice(0, 10)}…</span>
                      </td>
                      <td className="mono text-[0.62rem] whitespace-nowrap" title={r.e.hash}>
                        <span className="inline-flex items-center gap-1.5"><Swatch hash={r.e.hash} />{r.e.hash.slice(0, 10)}…</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {shown.length > 500 ? <p className="p-3 text-xs text-muted">Showing the first 500 of {shown.length}.</p> : null}
          </div>
        </div>

        <IntegrityPanel tapeId={id} attested={!!att} merkleRoot={att?.merkleRoot ?? null}
          recordCount={att?.recordCount ?? 0} signer={att?.signerEmail ?? null} />
      </div>
    </div>
  );
}
