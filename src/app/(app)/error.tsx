"use client";

import Link from "next/link";

/**
 * The last line of defence. A page that throws for any reason other than a role
 * check lands here instead of Next's raw "server-side exception" screen.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex flex-col gap-5 max-w-2xl">
      <div className="flex flex-col gap-1">
        <span className="eyebrow">Something failed</span>
        <h1 className="text-2xl font-semibold">This screen could not be built</h1>
        <p className="text-sm text-ink2">
          The failure was caught before anything was written. No loan record, exception or
          audit event changed as a result of this — the write paths are transactional and
          this was a read.
        </p>
      </div>
      {error.digest ? (
        <div className="card p-4 flex flex-col gap-1">
          <span className="eyebrow">Server log reference</span>
          <code className="font-mono text-sm">{error.digest}</code>
        </div>
      ) : null}
      <div className="flex gap-3">
        <button onClick={reset} className="btn btn-primary">Try again</button>
        <Link href="/tapes" className="btn">Back to tapes</Link>
      </div>
    </div>
  );
}
