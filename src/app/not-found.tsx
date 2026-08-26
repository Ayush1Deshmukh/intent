import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-6 py-24 flex flex-col gap-4">
      <span className="eyebrow">404</span>
      <h1 className="text-2xl font-semibold">No such page</h1>
      <p className="text-sm text-ink2">
        The link may point at a tape that was reset. Tapes are cleared whenever the demo
        is reset; the audit chain for a reset demo is cleared with it.
      </p>
      <div><Link href="/tapes" className="btn">Back to tapes</Link></div>
    </div>
  );
}
