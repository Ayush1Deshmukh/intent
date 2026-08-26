import Link from "next/link";
import { Action, POLICY, Role, ROLE_LABEL, ROLE_BLURB, ALL_ACTIONS } from "@/lib/policy";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Where requireRolePage() sends someone whose role does not carry the action.
 *
 * It names the action, the role they hold and the role the screen needs, because
 * "Forbidden" tells a person nothing about what to do next. The separation is the
 * product, so the refusal explains itself rather than apologising.
 */
export default async function DeniedPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; role?: string }>;
}) {
  const sp = await searchParams;
  const session = await getSession();

  const action = (ALL_ACTIONS as string[]).includes(sp.action ?? "")
    ? (sp.action as Action)
    : null;
  const role = (session?.role ?? sp.role) as Role | undefined;
  const allowed = action ? POLICY[action] : [];

  return (
    <div className="flex flex-col gap-5 max-w-2xl">
      <div className="flex flex-col gap-1">
        <span className="eyebrow">Separation of duties</span>
        <h1 className="text-2xl font-semibold">This screen belongs to another role</h1>
        <p className="text-sm text-ink2">
          Nothing went wrong. The check that stopped you is the same one that makes a
          signed-off tape worth anything — it runs on the server, before the page renders,
          not on a hidden button.
        </p>
      </div>

      <div className="card p-6 flex flex-col gap-4">
        {action ? (
          <div className="flex flex-col gap-1">
            <span className="eyebrow">Action</span>
            <code className="font-mono text-sm">{action}</code>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <span className="eyebrow">You are signed in as</span>
            <p className="font-serif text-lg">
              {role ? ROLE_LABEL[role] : "Not signed in"}
            </p>
            {role ? (
              <p className="text-sm text-muted">{ROLE_BLURB[role]}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1">
            <span className="eyebrow">This action needs</span>
            <p className="font-serif text-lg">
              {allowed.length ? allowed.map((r) => ROLE_LABEL[r]).join(" or ") : "—"}
            </p>
            {allowed.length === 1 ? (
              <p className="text-sm text-muted">{ROLE_BLURB[allowed[0]]}</p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <Link href="/tapes" className="btn">Back to tapes</Link>
        <Link href="/login" className="btn">Switch role</Link>
      </div>
    </div>
  );
}
