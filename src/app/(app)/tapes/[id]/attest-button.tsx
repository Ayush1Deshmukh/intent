"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { attestAction } from "@/app/actions";

export default function AttestButton({ tapeId, disabled, openGating }: {
  tapeId: string; disabled: boolean; openGating: number;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="flex flex-col items-end gap-1">
      <button className="btn btn-primary" disabled={pending || disabled}
        title={disabled ? `${openGating} gating exceptions are still open` : "Seal every eligible loan and sign the Merkle root"}
        onClick={() => start(async () => {
          const r = await attestAction(tapeId);
          if (r?.error) setError(r.error); else { setError(null); router.refresh(); }
        })}>
        {pending ? "Sealing…" : "Verify tape"}
      </button>
      {disabled ? <span className="text-[0.68rem] text-muted">{openGating} gating exceptions block sign-off</span> : null}
      {error ? <span className="text-[0.68rem] text-crit max-w-[240px] text-right">{error}</span> : null}
    </div>
  );
}
