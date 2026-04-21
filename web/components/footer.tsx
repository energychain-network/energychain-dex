export function Footer() {
  return (
    <footer className="mt-24 border-t border-white/5 bg-ink-950/60">
      <div className="mx-auto max-w-[1480px] px-4 py-8 text-sm text-ink-400">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-energy-400 to-energy-600 text-ink-950 text-sm font-black">⚡</span>
            <span className="text-ink-200">EnergySwap</span>
            <span className="chip ml-2">Production</span>
          </div>
          <div className="flex items-center gap-4">
            <a href={process.env.NEXT_PUBLIC_DEX_DOCS_URL || "https://github.com/energychain/dex"} className="hover:text-ink-100" target="_blank" rel="noreferrer">Docs</a>
            <a
              href={`${(process.env.NEXT_PUBLIC_DEX_API_BASE || "/api-proxy/api/v1").replace(/\/api\/v1$/, "")}/version`}
              className="hover:text-ink-100"
              target="_blank"
              rel="noreferrer"
            >API</a>
            <a href={process.env.NEXT_PUBLIC_DEX_GITHUB_URL || "https://github.com/energychain"} className="hover:text-ink-100" target="_blank" rel="noreferrer">GitHub</a>
          </div>
        </div>
        <div className="mt-4 text-xs text-ink-500">
          Trading involves risk. Always verify pair contracts before depositing.
        </div>
      </div>
    </footer>
  );
}
