// Sparkline is a tiny dependency-free SVG line chart used to visualize a
// native series (e.g. a mincast floor-price curve) without pulling in a
// charting library. It renders server-side; values are plain numbers
// already scaled into display units.

export function Sparkline({
  values,
  height = 96,
  stroke = '#34d399',
  fill = 'rgba(52,211,153,0.10)',
  className = '',
}: {
  values: number[];
  height?: number;
  stroke?: string;
  fill?: string;
  className?: string;
}) {
  const w = 600; // viewBox width; SVG scales to container via width=100%
  const h = height;
  const pad = 4;
  if (!values || values.length === 0) {
    return (
      <div className={`flex items-center justify-center text-xs text-ink-400 ${className}`} style={{ height: h }}>
        暂无数据
      </div>
    );
  }
  if (values.length === 1) values = [values[0], values[0]];

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = (w - pad * 2) / (values.length - 1);
  const y = (v: number) => h - pad - ((v - min) / span) * (h - pad * 2);
  const pts = values.map((v, i) => `${pad + i * stepX},${y(v)}`);
  const line = pts.map((p, i) => (i === 0 ? `M${p}` : `L${p}`)).join(' ');
  const area = `${line} L${pad + (values.length - 1) * stepX},${h - pad} L${pad},${h - pad} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={`w-full ${className}`} style={{ height: h }}>
      <path d={area} fill={fill} stroke="none" />
      <path d={line} fill="none" stroke={stroke} strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
