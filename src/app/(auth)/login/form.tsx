"use client";
import { useActionState } from "react";
import { loginAction } from "@/app/actions";

export default function LoginForm({ email, label, blurb, manual }: {
  email?: string; label?: string; blurb?: string; manual?: boolean;
}) {
  const [state, action, pending] = useActionState(loginAction, null as { error?: string } | null);

  if (manual) {
    return (
      <form action={action} className="flex flex-col gap-3 pt-4">
        <input name="email" type="email" placeholder="you@example.com" required />
        <input name="password" type="password" placeholder="password" required />
        <button className="btn btn-primary" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
        {state?.error ? <p className="text-crit text-sm">{state.error}</p> : null}
      </form>
    );
  }

  return (
    <form action={action}>
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="password" value="demo1234" />
      <button
        type="submit"
        disabled={pending}
        className="card w-full text-left p-4 hover:bg-surface2 transition-colors disabled:opacity-50"
      >
        <span className="flex items-center justify-between gap-3">
          <span className="font-serif font-semibold">{label}</span>
          <span className="mono text-[0.68rem] text-muted">{email}</span>
        </span>
        <span className="block text-xs text-ink2 mt-1.5 leading-relaxed">{blurb}</span>
      </button>
      {state?.error ? <p className="text-crit text-sm mt-1">{state.error}</p> : null}
    </form>
  );
}
