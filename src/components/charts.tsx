"use client";
import { useEffect, useRef, useState } from "react";

function useWidth<T extends HTMLElement>(fallback = 520) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Line chart with every point labelled, so it reads without hovering. */
export function LineChart({ points, label }: { points: { x: string; y: number; tag: string }[]; label: string }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  if (points.length < 2) return <div ref={ref} className="empty">Not enough history yet. A snapshot is saved every day.</div>;
  const H = 230, pl = 10, pr = 10, pt = 34, pb = 30;
  const ys = points.map((p) => p.y);
  const min = Math.min(...ys) * 0.97, max = Math.max(...ys) * 1.01 || 1;
  const x = (i: number) => pl + (i * (W - pl - pr)) / (points.length - 1);
  const y = (v: number) => pt + (1 - (v - min) / (max - min || 1)) * (H - pt - pb);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join("");
  const anchor = (i: number) => (i === 0 ? "start" : i === points.length - 1 ? "end" : "middle");
  const every = Math.ceil(points.length / Math.max(2, Math.floor(W / 70)));
  return (
    <div ref={ref}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <defs><linearGradient id="ga" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--brand)" stopOpacity=".22" /><stop offset="1" stopColor="var(--brand)" stopOpacity="0" /></linearGradient></defs>
        <path d={`${d}L${x(points.length - 1)},${H - pb}L${x(0)},${H - pb}Z`} fill="url(#ga)" className="fade" />
        <path d={d} fill="none" stroke="var(--brand)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="draw" style={{ ["--len" as string]: W * 2 }} />
        {points.map((p, i) => (i % every === 0 || i === points.length - 1) && (
          <g key={i} className="fade" style={{ animationDelay: `${0.2 + i * 0.05}s` }}>
            <circle cx={x(i)} cy={y(p.y)} r={i === points.length - 1 ? 5.5 : 4} fill="var(--surface)" stroke="var(--brand)" strokeWidth="2.5" />
            <text className="v" x={x(i)} y={y(p.y) - 12} textAnchor={anchor(i)}>{p.tag}</text>
            <text x={x(i)} y={H - 8} textAnchor={anchor(i)}>{p.x}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/** Paired bars with values written above each bar. */
export function PairBars({ groups, a, b, label, fmt }: {
  groups: { x: string; a: number; b: number }[]; a: { name: string; color: string }; b: { name: string; color: string };
  label: string; fmt: (v: number, narrow: boolean) => string;
}) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const H = 230, pt = 30, pb = 30, narrow = W < 460;
  const max = Math.max(1, ...groups.flatMap((g) => [Math.abs(g.a), Math.abs(g.b)]));
  const gw = W / groups.length, bw = Math.min(30, gw * 0.32);
  const h = (v: number) => (Math.abs(v) / max) * (H - pt - pb);
  const bar = (v: number, bx: number, color: string, delay: number, key: string) => {
    const bh = h(v), by = H - pb - bh;
    return v ? (
      <g key={key}>
        <rect className="grow" style={{ animationDelay: `${delay}s` }} x={bx} y={by} width={bw} height={bh} rx="4" fill={v < 0 ? "var(--loss)" : color} />
        <text className="v fade" style={{ animationDelay: `${delay + 0.4}s`, fontSize: narrow ? 10.5 : 12 }} x={bx + bw / 2} y={by - 6} textAnchor="middle">{fmt(v, narrow)}</text>
      </g>
    ) : <text key={key} x={bx + bw / 2} y={H - pb - 6} textAnchor="middle">0</text>;
  };
  return (
    <div ref={ref}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <line x1="0" x2={W} y1={H - pb} y2={H - pb} stroke="var(--line)" />
        {groups.map((g, i) => {
          const cx = gw * i + gw / 2;
          return (
            <g key={g.x}>
              {bar(g.a, cx - bw - 1, a.color, 0.1 + i * 0.08, "a")}
              {bar(g.b, cx + 1, b.color, 0.14 + i * 0.08, "b")}
              <text x={cx} y={H - 8} textAnchor="middle">{g.x}</text>
            </g>
          );
        })}
        <g>
          <rect x={W - 190} y="0" width="10" height="10" rx="2" fill={a.color} /><text x={W - 175} y="9">{a.name}</text>
          <rect x={W - 92} y="0" width="10" height="10" rx="2" fill={b.color} /><text x={W - 77} y="9">{b.name}</text>
        </g>
      </svg>
    </div>
  );
}
