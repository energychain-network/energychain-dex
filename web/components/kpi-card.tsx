export function KPICard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: 'energy' | 'bull' | 'bear' }) {
  const accentClass =
    accent === 'energy' ? 'from-energy-500/20 to-energy-700/0' :
    accent === 'bull' ? 'from-bull/20 to-bull-700/0' :
    accent === 'bear' ? 'from-bear/20 to-bear-700/0' :
    'from-white/10 to-transparent';
  return (
    <div className="relative overflow-hidden card p-5">
      <div className={`pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-gradient-to-br ${accentClass} blur-2xl`} />
      <div className="text-xs uppercase tracking-wider text-ink-400">{label}</div>
      <div className="mt-2 text-2xl md:text-3xl font-semibold text-ink-100">{value}</div>
      {sub && <div className="mt-1 text-xs text-ink-400">{sub}</div>}
    </div>
  );
}
