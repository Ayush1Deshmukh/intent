import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { logoutAction } from "@/app/actions";
import { ROLE_LABEL, can } from "@/lib/policy";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const links = [
    { href: "/tapes", label: "Tapes", show: true },
    { href: "/review", label: "Review queue", show: can(session.role, "proposal:approve") },
    { href: "/rules", label: "Rule library", show: true },
    { href: "/verified", label: "Verified records", show: true },
    { href: "/docs", label: "API docs", show: true },
  ].filter((l) => l.show);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-line bg-surface sticky top-0 z-20">
        <div className="mx-auto max-w-[1400px] px-6 flex items-center gap-6 h-14">
          <Link href="/tapes" className="font-serif font-semibold text-[0.98rem] no-underline text-ink">
            Verified&nbsp;Tape
          </Link>
          <nav className="flex items-center gap-1 flex-1">
            {links.map((l) => (
              <Link key={l.href} href={l.href}
                className="mono text-[0.72rem] px-2.5 py-1.5 rounded-md text-muted hover:text-ink hover:bg-surface2 no-underline">
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <span className="text-right leading-tight hidden sm:block">
              <span className="block text-xs font-medium">{session.name}</span>
              <span className="block mono text-[0.62rem] text-muted uppercase tracking-wider">{ROLE_LABEL[session.role]}</span>
            </span>
            <form action={logoutAction}><button className="btn btn-sm">Sign out</button></form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] w-full px-6 py-8 flex-1">{children}</main>
    </div>
  );
}
