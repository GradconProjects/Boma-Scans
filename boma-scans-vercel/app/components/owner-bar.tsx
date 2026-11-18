"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { SignOutButton } from "@/app/components/sign-out-button";
import { SystemSwitch } from "@/app/components/system-switch";
import { WindowBanner } from "@/app/components/window-banner";
import { UpdateWatcher } from "@/app/components/update-watcher";

/**
 * Top bar on every page. Sign-in state is read in the browser (not only at
 * render time) so a cached page shell can never show "Sign in" to a signed-in
 * owner, and the Melbourne trading-window statement is always present.
 */
export function OwnerBar({ initialSignedIn = false }: { initialSignedIn?: boolean }) {
  const [signedIn, setSignedIn] = useState(initialSignedIn);
  useEffect(() => {
    let stopped = false;
    const check = async () => { try { const d = await (await fetch("/api/session", { cache: "no-store" })).json() as { signedIn?: boolean }; if (!stopped && typeof d.signedIn === "boolean") setSignedIn(d.signedIn); } catch { /* offline */ } };
    void check();
    const timer = window.setInterval(() => void check(), 60_000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, []);
  return (
    <nav aria-label="Owner session" className="flex flex-wrap items-center justify-between gap-2 border-b border-cyan-300/20 bg-[#07131c] px-4 py-2 text-sm">
      <span className="flex items-center gap-3"><span className="font-semibold text-cyan-100">Boma Scans</span>{signedIn && <SystemSwitch/>}</span>
      <UpdateWatcher/>
      {signedIn && <WindowBanner compact/>}
      {signedIn ? (
        <span className="flex items-center gap-3 text-slate-300">
          Signed in · journal and Telegram sync active
          <SignOutButton />
        </span>
      ) : (
        <Link href="/login" className="rounded-lg border border-cyan-300/40 px-3 py-1.5 font-semibold text-cyan-100 hover:bg-cyan-300/10">
          Sign in
        </Link>
      )}
    </nav>
  );
}
