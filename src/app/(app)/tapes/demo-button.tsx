"use client";
import { useTransition } from "react";
import { loadDemoTapeAction } from "@/app/actions";

export default function DemoButton() {
  const [pending, start] = useTransition();
  return (
    <button className="btn" disabled={pending} onClick={() => start(() => { void loadDemoTapeAction(); })}>
      {pending ? "Loading 500 rows…" : "Load the demo tape"}
    </button>
  );
}
