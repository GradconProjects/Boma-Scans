"use client";
import { useEffect, useState } from "react";
import type { Positioning } from "@/app/lib/positioning";

const REFRESH_MS = 3 * 60_000;

/** Whale and venue positioning for a set of pairs, refreshed every 3 minutes while the tab is visible. */
export function usePositioning(symbols: string[]) {
  const [data, setData] = useState<Record<string, Positioning>>({});
  const [meta, setMeta] = useState<{ at: number; traders: number } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const key = Array.from(new Set(symbols)).slice(0, 16).join(",");
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    let active = true;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      setLoading(true);
      try {
        const response = await fetch("/api/positioning?symbols=" + key, { cache: "no-store", signal: controller.signal });
        const payload = await response.json() as { error?: string; at?: number; traders?: number; data?: Record<string, Positioning> };
        if (!response.ok) throw new Error(payload.error || "Positioning unavailable.");
        if (active) { setData(prev => ({ ...prev, ...payload.data })); setMeta({ at: payload.at ?? Date.now(), traders: payload.traders ?? 0 }); setError(""); }
      } catch (caught) { if (active && !controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Positioning unavailable."); }
      finally { if (active) setLoading(false); }
    };
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => { active = false; controller.abort(); window.clearInterval(timer); };
  }, [key, reload]);
  return { data, meta, error, loading, refresh: () => setReload(v => v + 1) };
}
