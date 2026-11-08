export function VersionSwitcher({current}: {current: "telegram" | "before"}) {
  const links=[{id:"telegram",title:"Boma W Telegram",url:"https://boma-scans-version-15.bomsilaga.chatgpt.site"},{id:"before",title:"Before Telegram",url:"https://boma-before-telegram.bomsilaga.chatgpt.site"}];
  return <nav aria-label="Switch Boma version" className="flex flex-wrap items-center justify-center gap-2 border-b border-cyan-300/20 bg-[#07131c] px-3 py-3 text-sm">
    <span className="mr-1 text-slate-400">Choose version</span>
    {links.map(link=><a key={link.id} href={link.url} aria-current={current===link.id?"page":undefined} className={"rounded-lg border px-3 py-2 font-semibold "+(current===link.id?"border-cyan-300/50 bg-cyan-300/15 text-cyan-100":"border-white/15 text-slate-300 hover:bg-white/10")}>{link.title}</a>)}
    <a href="/versions" className="rounded-lg px-3 py-2 text-slate-300 underline underline-offset-4">Compare side by side</a>
  </nav>;
}
