"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    try {
      await fetch("/api/session", { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" onClick={signOut} disabled={busy} className="rounded-lg border border-white/15 px-3 py-1.5 text-slate-300 hover:bg-white/10">
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
