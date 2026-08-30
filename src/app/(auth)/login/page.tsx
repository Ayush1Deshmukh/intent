import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ROLE_BLURB, ROLE_LABEL, Role } from "@/lib/policy";
import LoginForm from "./form";
import Pipeline from "./pipeline";

const DEMO: { role: Role; email: string }[] = [
  { role: "DATA_OPERATOR", email: "operator@intain.demo" },
  { role: "REVIEWER", email: "reviewer@intain.demo" },
  { role: "DATA_CONSUMER", email: "consumer@intain.demo" },
];

export default async function LoginPage() {
  if (await getSession()) redirect("/tapes");
  return (
    <main className="min-h-screen grid lg:grid-cols-[1fr_460px]">
      <section className="hidden lg:flex flex-col justify-between gap-8 p-12 bg-surface border-r border-line overflow-y-auto">
        <div className="flex flex-col gap-6 max-w-xl">
          <div className="flex flex-col gap-4 rise">
            <span className="eyebrow">Loan Data Verification Copilot</span>
            <h1 className="text-5xl font-semibold leading-[1.05]">Verified Tape</h1>
            <p className="text-ink2 leading-relaxed max-w-lg">
              Loan tapes arrive broken. This system doesn&rsquo;t just find the breaks — it produces
              a record you can prove wasn&rsquo;t touched afterwards.
            </p>
          </div>

          <div className="flex flex-col gap-2.5 text-sm text-ink2 border-l-2 border-brass pl-4 rise"
            style={{ animationDelay: "0.08s" }}>
            <p><strong className="text-ink">The deterministic core owns the data.</strong> Every rule is arithmetic, not judgement.</p>
            <p><strong className="text-ink">The AI only advises.</strong> It files proposals; it holds no credential that can write to a loan.</p>
            <p><strong className="text-ink">The record proves itself.</strong> Hash-chained events, a Merkle root, and a check anyone can run.</p>
          </div>

          <div className="pt-2 rise" style={{ animationDelay: "0.16s" }}>
            <Pipeline />
          </div>
        </div>

        <p className="text-xs text-muted mono shrink-0">three roles · 28 rules · append-only audit chain</p>
      </section>

      <section className="flex flex-col justify-center gap-6 p-8 lg:p-12">
        <div className="flex flex-col gap-1 rise">
          <span className="eyebrow">Sign in</span>
          <h2 className="text-2xl font-semibold">Pick a role</h2>
          <p className="text-sm text-muted">One click. No typing. Every role sees a different product.</p>
        </div>

        <div className="flex flex-col gap-3 stagger">
          {DEMO.map((d) => (
            <LoginForm key={d.role} email={d.email} label={ROLE_LABEL[d.role]} blurb={ROLE_BLURB[d.role]} />
          ))}
        </div>

        <details className="text-sm text-muted">
          <summary className="cursor-pointer">Sign in with an email and password instead</summary>
          <LoginForm manual />
        </details>
      </section>
    </main>
  );
}
