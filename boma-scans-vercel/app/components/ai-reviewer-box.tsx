"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Settings = { provider: "anthropic" | "openai" | "off"; available: string[]; anthropicModel: string; openaiModel: string; swapped?: boolean };

/** Provider switch for the second-read reviewer (Anthropic / OpenAI / off) and what it does. */
export function AiReviewerBox() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/ai", { cache: "no-store", signal: controller.signal }).then(async r => { const d = await r.json() as { settings?: Settings; error?: string }; if (d.settings) setSettings(d.settings); else if (d.error) setStatus(d.error); }).catch(() => undefined);
    return () => controller.abort();
  }, []);
  const choose = async (provider: Settings["provider"]) => {
    setBusy(true); setStatus("");
    try {
      const r = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider }) });
      const d = await r.json() as { settings?: Settings; error?: string };
      if (!r.ok || !d.settings) throw new Error(d.error || "Could not switch provider.");
      setSettings(d.settings); setStatus(provider === "off" ? "Reviewer off: signals are pushed without a second read." : "Reviewer: " + (provider === "anthropic" ? "Claude (" + d.settings.anthropicModel + ")" : "OpenAI (" + d.settings.openaiModel + ")"));
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not switch provider."); }
    finally { setBusy(false); }
  };
  const available = settings?.available ?? [];
  return <div className="mt-3 rounded-xl border border-violet-300/20 bg-violet-300/5 p-3">
    <p className="text-sm font-semibold text-violet-100">🧠 AI reviewer · careful second read before a signal is pushed</p>
    <p className="mt-1 text-xs leading-5 text-slate-400">Every ready-to-enter signal is reviewed against the checks, the historic levels, the whale and crowd positioning and the last 24 candles. APPROVE and CAUTION are pushed with the note; REJECT is held and listed in the hourly monitor list. On Telegram: <span className="font-mono">/why BTCUSDT</span> for a plain-English read, <span className="font-mono">/review BTCUSDT</span> for a fresh verdict, <span className="font-mono">/ai anthropic|openai|off</span> to switch.</p>
    <div className="mt-2 flex flex-wrap gap-2">
      {(["anthropic", "openai", "off"] as const).map(provider => <Button key={provider} type="button" size="sm" variant={settings?.provider === provider ? "default" : "outline"} disabled={busy || (provider !== "off" && !available.includes(provider))} onClick={() => void choose(provider)} className="rounded-lg">{provider === "anthropic" ? "Claude (Anthropic)" : provider === "openai" ? "OpenAI" : "Off"}</Button>)}
    </div>
    {settings && <p className="mt-2 text-[11px] text-slate-500">{available.length ? "Keys found: " + available.join(", ") + ". Models: " + settings.anthropicModel + " · " + settings.openaiModel + " (override with ANTHROPIC_MODEL / OPENAI_MODEL)." : "No key found. In Vercel → Settings → Environment Variables add ANTHROPIC_API_KEY (and optionally OPENAI_API_KEY), then Redeploy."}</p>}
    {settings?.swapped && <p className="mt-1 text-[11px] text-amber-200">Note: the keys in Vercel are in each other&apos;s variables (an sk-ant- key sits in OPENAI_API_KEY). The app sorts them by shape, so both work; swap them when convenient.</p>}
    {status && <p className="mt-1 text-xs text-slate-300">{status}</p>}
  </div>;
}
