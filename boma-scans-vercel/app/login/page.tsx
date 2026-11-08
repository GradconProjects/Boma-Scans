"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

type SessionState = { configured: boolean; signedIn: boolean; changeable: boolean; source: "app" | "env" };

export default function Login() {
  const router = useRouter();
  const [state, setState] = useState<SessionState | null>(null);
  const [password, setPassword] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try { const response = await fetch("/api/session", { cache: "no-store" }); setState(await response.json() as SessionState); } catch { /* keep the form usable */ }
  }
  useEffect(() => { void refresh(); }, []);

  async function signIn(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error);
      setPassword(""); await refresh(); router.refresh(); setMessage("Signed in. This device stays signed in for 90 days."); router.push("/start");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Sign-in failed."); } finally { setBusy(false); }
  }

  async function change(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/session", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current, next }) });
      const body = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(body.error);
      setCurrent(""); setNext(""); setMessage(body.message ?? "Password changed."); await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Password change failed."); } finally { setBusy(false); }
  }

  async function signOut() {
    setBusy(true);
    try { await fetch("/api/session", { method: "DELETE" }); await refresh(); router.refresh(); setMessage("Signed out on this device."); } finally { setBusy(false); }
  }

  const input = "mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 p-3 font-mono";
  return (
    <main className="mx-auto min-h-screen max-w-lg px-6 py-16 text-slate-100">
      <Link href="/" className="text-cyan-200">← Boma Scans</Link>
      <h1 className="mt-8 text-3xl font-semibold">Owner sign-in</h1>
      {state?.signedIn ? <>
        <p className="mt-3 leading-7 text-slate-400">You are signed in on this device. Your settings, journal and Telegram alerts follow this account.{state.source === "app" ? " The password was set from the app." : " The password is the BOMA_SYNC_SECRET variable from Vercel."}</p>
        <div className="mt-4 flex flex-wrap gap-3"><Link href="/" className="rounded-xl bg-cyan-200 px-5 py-3 font-semibold text-slate-950">📡 Signal scanner</Link><Link href="/whales" className="rounded-xl bg-violet-200 px-5 py-3 font-semibold text-slate-950">🐋 Whale system</Link><Link href="/before-telegram" className="rounded-xl bg-amber-200 px-5 py-3 font-semibold text-slate-950">🕰 Before Telegram</Link><button type="button" onClick={signOut} disabled={busy} className="rounded-xl border border-slate-600 px-5 py-3 text-slate-200">Sign out</button></div>
        <h2 className="mt-10 text-xl font-semibold">Change password</h2>
        <p className="mt-2 text-sm leading-6 text-slate-400">Any password of 4 or more characters works. Short PINs are easier to guess, so sign-in attempts are throttled per address and overall; a longer passphrase is still safer.{state.changeable ? "" : " Changing it here needs the database connection; until then change BOMA_SYNC_SECRET in Vercel."}</p>
        <form onSubmit={change} className="mt-4 space-y-4">
          <label className="block text-sm text-slate-300">Current password<input type="password" autoComplete="current-password" required value={current} onChange={event => setCurrent(event.target.value)} className={input}/></label>
          <label className="block text-sm text-slate-300">New password<input type="password" autoComplete="new-password" required minLength={4} value={next} onChange={event => setNext(event.target.value)} className={input}/></label>
          <button disabled={busy || !state.changeable} className="rounded-xl bg-cyan-200 px-5 py-3 font-semibold text-slate-950 disabled:opacity-50">{busy ? "Saving…" : "Change password"}</button>
        </form>
      </> : <>
        <p className="mt-3 leading-7 text-slate-400">Enter your owner password once per device; it stays signed in for 90 days. Signing in syncs your workspace and trade journal and enables Telegram alerts and commands.</p>
        <form onSubmit={signIn} className="mt-6 space-y-4">
          <label className="block text-sm text-slate-300">Owner password<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} className={input} autoFocus/></label>
          <button disabled={busy} className="rounded-xl bg-cyan-200 px-5 py-3 font-semibold text-slate-950">{busy ? "Signing in…" : "Sign in"}</button>
        </form>
        {state && !state.configured && <p className="mt-4 text-sm text-amber-200">BOMA_SYNC_SECRET is missing or shorter than 4 characters in Vercel. Set it under Settings → Environment Variables, then Redeploy.</p>}
      </>}
      {error && <p role="alert" className="mt-4 text-amber-200">{error}</p>}
      {message && <p role="status" className="mt-4 text-emerald-200">{message}</p>}
    </main>
  );
}
