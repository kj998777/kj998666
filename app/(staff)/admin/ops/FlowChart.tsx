import { niceMax, type FlowDay } from "@/lib/ops/flow";

// 최근 30일 흐름(2026-09-30) — 서버에서 그리는 SVG 막대그래프 두 개(검토 제출 · 포인트). 라이브러리 없이.

const W = 480;
const H = 140;
const L = 34; // 왼쪽 눈금 자리
const R = 8;
const T = 10;
const B = 22; // 아래 날짜 자리

function Axis({ max, y0, h, fmt }: { max: number; y0: number; h: number; fmt?: (n: number) => string }) {
  const ticks = Number.isInteger(max / 2) ? [0, max / 2, max] : [0, max];
  return (
    <g>
      {ticks.map((v) => {
        const y = y0 - (v / max) * h;
        return (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y} y2={y} stroke="currentColor" strokeOpacity={v === 0 ? 0.35 : 0.12} />
            <text x={L - 4} y={y + 3} textAnchor="end" fontSize="11" fill="currentColor" fillOpacity={0.6}>
              {fmt ? fmt(v) : Math.round(v)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function DayLabels({ days, bw }: { days: FlowDay[]; bw: number }) {
  return (
    <g>
      {days.map((d, i) =>
        i % 7 === (days.length - 1) % 7 ? (
          <text key={d.day} x={L + i * bw + bw / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="currentColor" fillOpacity={0.6}>
            {d.day.slice(5).replace("-", "/")}
          </text>
        ) : null
      )}
    </g>
  );
}

export default function FlowChart({ days }: { days: FlowDay[] }) {
  const n = Math.max(1, days.length);
  const bw = (W - L - R) / n;
  const gap = Math.min(3, bw * 0.25);
  const h = H - T - B;
  const y0 = T + h;
  const revMax = niceMax(Math.max(0, ...days.map((d) => d.primary + d.verify)));
  const pMax = niceMax(Math.max(0, ...days.map((d) => Math.max(d.issued, d.spent))));
  const totals = days.reduce(
    (s, d) => ({ p: s.p + d.primary, v: s.v + d.verify, i: s.i + d.issued, o: s.o + d.spent }),
    { p: 0, v: 0, i: 0, o: 0 }
  );
  const half = (bw - gap) / 2;
  return (
    <div className="grid gap-4 md:grid-cols-2 text-slate-700">
      <figure className="space-y-1 min-w-0">
        <figcaption className="text-sm flex flex-wrap items-center gap-x-3">
          <span className="font-medium">검토 제출(하루)</span>
          <span className="text-xs text-slate-500">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-sky-600 align-middle mr-1" />
            첫 검토 {totals.p}
          </span>
          <span className="text-xs text-slate-500">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-violet-400 align-middle mr-1" />
            판정·확인 {totals.v}
          </span>
        </figcaption>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`최근 ${n}일 검토 제출: 첫 검토 ${totals.p}건, 판정 ${totals.v}건`}>
          <Axis max={revMax} y0={y0} h={h} />
          {days.map((d, i) => {
            const x = L + i * bw + gap / 2;
            const hp = (d.primary / revMax) * h;
            const hv = (d.verify / revMax) * h;
            return (
              <g key={d.day}>
                <title>{`${d.day}: 첫 검토 ${d.primary} · 판정 ${d.verify}`}</title>
                {hp > 0 && <rect x={x} y={y0 - hp} width={bw - gap} height={hp} fill="#0284c7" />}
                {hv > 0 && <rect x={x} y={y0 - hp - hv} width={bw - gap} height={hv} fill="#a78bfa" />}
              </g>
            );
          })}
          <DayLabels days={days} bw={bw} />
        </svg>
      </figure>
      <figure className="space-y-1 min-w-0">
        <figcaption className="text-sm flex flex-wrap items-center gap-x-3">
          <span className="font-medium">포인트(하루)</span>
          <span className="text-xs text-slate-500">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-600 align-middle mr-1" />
            발행 {totals.i}P
          </span>
          <span className="text-xs text-slate-500">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-rose-500 align-middle mr-1" />
            사용 {totals.o}P
          </span>
        </figcaption>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`최근 ${n}일 포인트: 발행 ${totals.i}P, 사용 ${totals.o}P`}>
          <Axis max={pMax} y0={y0} h={h} />
          {days.map((d, i) => {
            const x = L + i * bw + gap / 2;
            const hi = (d.issued / pMax) * h;
            const ho = (d.spent / pMax) * h;
            return (
              <g key={d.day}>
                <title>{`${d.day}: 발행 ${d.issued}P · 사용 ${d.spent}P`}</title>
                {hi > 0 && <rect x={x} y={y0 - hi} width={half} height={hi} fill="#059669" />}
                {ho > 0 && <rect x={x + half} y={y0 - ho} width={half} height={ho} fill="#f43f5e" />}
              </g>
            );
          })}
          <DayLabels days={days} bw={bw} />
        </svg>
      </figure>
    </div>
  );
}
