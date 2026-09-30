// 운영 현황 "최근 30일 흐름" 그래프용 — 날짜(한국 기준)별로 검토 제출·포인트 발행/사용을 센다(DB 없이 시험 가능).

export type FlowDay = { day: string; primary: number; verify: number; issued: number; spent: number };

const KST = 9 * 3600 * 1000;

/** UTC ISO 시각 → 한국 날짜 "YYYY-MM-DD" */
export function kstDay(t: string | number | Date): string {
  const ms = typeof t === "number" ? t : new Date(t).getTime();
  return new Date(ms + KST).toISOString().slice(0, 10);
}

/** 오늘(한국)까지 days일 — 오래된 날부터. 기록이 없는 날도 0으로 채운다. */
export function dailyFlow(
  reviews: { kind: string; created_at: string }[],
  ledger: { delta: number; created_at: string }[],
  days: number,
  now: number
): FlowDay[] {
  const out: FlowDay[] = [];
  const idx = new Map<string, FlowDay>();
  for (let i = days - 1; i >= 0; i--) {
    const d = kstDay(now - i * 86400000);
    const row = { day: d, primary: 0, verify: 0, issued: 0, spent: 0 };
    out.push(row);
    idx.set(d, row);
  }
  for (const r of reviews) {
    const row = idx.get(kstDay(r.created_at));
    if (!row) continue;
    if (r.kind === "verify") row.verify++;
    else row.primary++;
  }
  for (const l of ledger) {
    const row = idx.get(kstDay(l.created_at));
    if (!row) continue;
    const d = Number(l.delta) || 0;
    if (d > 0) row.issued += d;
    else row.spent -= d;
  }
  return out;
}

/** 눈금 최댓값: 1·2·5×10^n 중 max 이상인 가장 작은 값(0이면 1) */
export function niceMax(max: number): number {
  if (!(max > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(max)));
  for (const m of [1, 2, 5, 10]) if (m * p >= max) return m * p;
  return 10 * p;
}
