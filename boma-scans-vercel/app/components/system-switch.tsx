"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

export type SystemView = "scanner" | "whales";
export const VIEW_EVENT = "boma:view";

/** Current system from the URL: /whales or ?view=whales means the whale system. */
export function readView(): SystemView {
  if (typeof window === "undefined") return "scanner";
  return window.location.pathname.startsWith("/whales") || new URLSearchParams(window.location.search).get("view") === "whales" ? "whales" : "scanner";
}

/**
 * Segmented switch between the two systems. On the main page it swaps the
 * view in place (the scanner keeps running hidden, so switching back is
 * instant); from any other route it navigates to the main page.
 */
export function SystemSwitch() {
  const pathname = usePathname();
  const router = useRouter();
  const [view, setView] = useState<SystemView>("scanner");
  useEffect(() => {
    const sync = () => setView(readView());
    sync();
    window.addEventListener("popstate", sync); window.addEventListener(VIEW_EVENT, sync);
    return () => { window.removeEventListener("popstate", sync); window.removeEventListener(VIEW_EVENT, sync); };
  }, [pathname]);
  const go = (next: SystemView) => {
    if (next === view) return;
    if (pathname === "/") {
      const url = new URL(window.location.href);
      if (next === "whales") url.searchParams.set("view", "whales"); else url.searchParams.delete("view");
      window.history.pushState({}, "", url.toString());
      window.dispatchEvent(new Event(VIEW_EVENT));
      setView(next);
    } else router.push(next === "whales" ? "/?view=whales" : "/");
  };
  return <div role="tablist" aria-label="System" className="flex rounded-xl border border-white/10 bg-slate-950/60 p-0.5 text-xs font-semibold">
    <button type="button" role="tab" aria-selected={view === "scanner"} onClick={() => go("scanner")} className={"rounded-lg px-3 py-1.5 transition " + (view === "scanner" ? "bg-cyan-300/20 text-cyan-100" : "text-slate-400 hover:text-white")}>📡 Scanner</button>
    <button type="button" role="tab" aria-selected={view === "whales"} onClick={() => go("whales")} className={"rounded-lg px-3 py-1.5 transition " + (view === "whales" ? "bg-violet-300/20 text-violet-100" : "text-slate-400 hover:text-white")}>🐋 Whales</button>
  </div>;
}
