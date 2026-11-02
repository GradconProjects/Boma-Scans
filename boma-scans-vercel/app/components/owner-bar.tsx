import Link from "next/link";
import { getOwnerUser } from "@/app/server/owner-auth";
import { SignOutButton } from "@/app/components/sign-out-button";

/** Server component: shows the owner session state at the top of every page. */
export async function OwnerBar() {
  const owner = await getOwnerUser();
  return (
    <nav aria-label="Owner session" className="flex flex-wrap items-center justify-between gap-2 border-b border-cyan-300/20 bg-[#07131c] px-4 py-2 text-sm">
      <span className="font-semibold text-cyan-100">Boma Scans</span>
      {owner ? (
        <span className="flex items-center gap-3 text-slate-300">
          Signed in · journal and Telegram sync active
          <SignOutButton />
        </span>
      ) : (
        <Link href="/login" className="rounded-lg border border-cyan-300/40 px-3 py-1.5 font-semibold text-cyan-100 hover:bg-cyan-300/10">
          Sign in to sync &amp; Telegram
        </Link>
      )}
    </nav>
  );
}
