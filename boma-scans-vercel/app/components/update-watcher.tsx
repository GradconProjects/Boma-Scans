"use client";
import { useEffect, useRef, useState } from "react";

/**
 * The dashboard is kept open for days, so a new deploy would never be seen.
 * Every two minutes the page asks which build is live; when it changes, the
 * page reloads itself the next time the tab is visible, and says so first.
 */
export function UpdateWatcher() {
  const first = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      try {
        const d = await (await fetch("/api/version", { cache: "no-store" })).json() as { build?: string };
        if (!d.build || stopped) return;
        if (first.current === null) { first.current = d.build; return; }
        if (d.build !== first.current) {
          setPending(true);
          if (document.visibilityState === "visible") window.setTimeout(() => window.location.reload(), 4000);
        }
      } catch { /* offline */ }
    };
    void check();
    const timer = window.setInterval(() => void check(), 120_000);
    const onVisible = () => { if (document.visibilityState === "visible" && pending) window.location.reload(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { stopped = true; window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [pending]);
  if (!pending) return null;
  return <div role="status" className="fixed inset-x-0 bottom-0 z-[100] bg-cyan-300 px-4 py-2 text-center text-sm font-semibold text-slate-950">A new version of Boma Scans is live. Reloading… <button type="button" onClick={() => window.location.reload()} className="ml-2 underline">Reload now</button></div>;
}
