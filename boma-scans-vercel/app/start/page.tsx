import Link from "next/link";
import { redirect } from "next/navigation";
import { getOwnerUser } from "@/app/server/owner-auth";

/** After sign-in: choose between the two systems. */
export default async function StartPage() {
  const owner = await getOwnerUser();
  if (!owner) redirect("/login");
  return <main className="mx-auto flex min-h-[80vh] max-w-3xl flex-col justify-center px-4 py-10 text-slate-100">
    <p className="text-xs font-bold uppercase tracking-widest text-cyan-200">Boma Scans</p>
    <h1 className="mt-2 text-3xl font-bold text-white">Where to?</h1>
    <p className="mt-2 text-slate-400">Two independent systems share your sign-in, Telegram bot and database.</p>
    <div className="mt-8 grid gap-4 sm:grid-cols-3">
      <Link href="/" className="rounded-3xl border border-cyan-300/30 bg-cyan-300/[0.06] p-6 transition hover:bg-cyan-300/[0.12]">
        <p className="text-2xl">📡</p>
        <h2 className="mt-2 text-xl font-semibold text-white">Signal scanner</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">Rule-based 1H setups on every Bybit USDT perpetual, backtested over two years: entry window, trigger, stop, five targets, AI second read, monitoring and exits on Telegram.</p>
      </Link>
      <Link href="/?view=whales" className="rounded-3xl border border-violet-300/30 bg-violet-300/[0.06] p-6 transition hover:bg-violet-300/[0.12]">
        <p className="text-2xl">🐋</p>
        <h2 className="mt-2 text-xl font-semibold text-white">Whale system</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">What consistently successful Hyperliquid whales are doing now: live opens, adds and closes, performance rankings, and confirmed signals when several ranked whales enter the same side.</p>
      </Link>
      <Link href="/before-telegram" className="rounded-3xl border border-amber-300/30 bg-amber-300/[0.06] p-6 transition hover:bg-amber-300/[0.12]">
        <p className="text-2xl">🕰</p>
        <h2 className="mt-2 text-xl font-semibold text-white">Before Telegram</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">The original scanner build, exactly as it was before the Telegram and whale work, with its own workspace and journal. Same sign-in, same Bybit data.</p>
      </Link>
    </div>
  </main>;
}
