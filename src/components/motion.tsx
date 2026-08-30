"use client";
import { useEffect, useRef, useState } from "react";

/**
 * A number that counts up to its value once, on mount.
 *
 * Used only on the headline figures — rows, exceptions, clean percentage, gating
 * open. The point is not decoration: those four numbers are the finding, and
 * watching them arrive makes the screen read as a measurement that was taken
 * rather than a page that was rendered.
 *
 * It settles on the exact value, always, and honours prefers-reduced-motion by
 * skipping straight there. Tabular numerals keep the digits from jittering.
 */
export function CountUp({ value, decimals = 0, suffix = "", durationMs = 900 }: {
  value: number; decimals?: number; suffix?: string; durationMs?: number;
}) {
  const [shown, setShown] = useState(value);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced || value === 0) { setShown(value); return; }

    const started = performance.now();
    setShown(0);
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / durationMs);
      // ease-out-cubic: fast first, settles gently, no overshoot on a real figure
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(t === 1 ? value : value * eased);
      if (t < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => { if (frame.current) cancelAnimationFrame(frame.current); };
  }, [value, durationMs]);

  return (
    <span className="tnum">
      {shown.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  );
}

/**
 * Reveals its children once they scroll into view. Used for the long lists
 * further down a page, so arriving at them feels like arriving rather than
 * finding them already there.
 */
export function Reveal({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") { setSeen(true); return; }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setSeen(true); io.disconnect(); }
    }, { rootMargin: "-40px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return <div ref={ref} className={`${seen ? "rise" : "opacity-0"} ${className}`}>{children}</div>;
}
