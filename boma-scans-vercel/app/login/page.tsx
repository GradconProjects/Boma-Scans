"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export default function Login() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error);
      router.push("/");
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-lg px-6 py-16 text-slate-100">
      <Link href="/" className="text-cyan-200">← Boma Scans</Link>
      <h1 className="mt-8 text-3xl font-semibold">Owner sign-in</h1>
      <p className="mt-3 leading-7 text-slate-400">
        Use the owner password you set in Vercel (BOMA_SYNC_SECRET) on each of your devices. Signing in syncs your workspace and trade journal and enables Telegram alerts and commands.
      </p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <label className="block">
          Owner password
          <input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 p-3" />
        </label>
        {error && <p role="alert" className="text-amber-200">{error}</p>}
        <button disabled={busy} className="rounded-xl bg-cyan-200 px-5 py-3 font-semibold text-slate-950">{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </main>
  );
}
