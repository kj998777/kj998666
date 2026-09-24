// 배점 임의 배정. Apps Script의 assignPoints_ 를 그대로 포팅.

import type { Difficulty } from "@/lib/supabase/types";

/** 난이도별 배점 가중치(하 1 · 중하 1.25 · 중 1.5 · 중상 1.75 · 상 2배) */
export const DIFF_W: Record<Difficulty, number> = { 하: 1, 중하: 1.25, 중: 1.5, 중상: 1.75, 상: 2 };

export type PointRow = { points: number | null; diff: Difficulty; assigned?: boolean };

/**
 * 인쇄된 배점이 없는 문항에, 남은 점수(100 − 인쇄된 배점 합)를 난이도 가중치에 비례해 나눠 준다
 * (합 100). 배정한 문항의 assigned 를 true 로 설정(rows를 직접 수정).
 * 점수 단위는 0.5점(남은 점수가 0.5 단위가 아니면 0.1점)이고, 내림하고 남는 점수는 난이도가 높은
 * 문항부터 한 단위씩 더해 합을 정확히 맞춘다(같은 난이도끼리는 배점 차이가 한 단위 이하).
 */
export function assignPoints(rows: PointRow[]): void {
  let printed = 0;
  const unp: PointRow[] = [];
  for (const r of rows) {
    if (r.points == null) unp.push(r);
    else printed += r.points;
  }
  if (!unp.length) return;
  const remain = Math.round((100 - printed) * 10) / 10;
  if (remain <= 0) {
    for (const r of unp) {
      r.points = 0;
      r.assigned = true;
    }
    return;
  }
  const unit = Math.abs(remain * 2 - Math.round(remain * 2)) < 1e-9 ? 0.5 : 0.1;
  const tot = Math.round(remain / unit);
  const ws = unp.map((r) => DIFF_W[r.diff] ?? DIFF_W["중"]);
  const wsum = ws.reduce((a, b) => a + b, 0);
  const cnt = ws.map((w) => Math.floor((tot * w) / wsum + 1e-9));
  let used = cnt.reduce((a, b) => a + b, 0);
  const order = ws
    .map((w, i) => ({ i, f: (tot * w) / wsum - cnt[i], w }))
    .sort((a, b) => b.w - a.w || b.f - a.f || b.i - a.i); // 남는 점수는 난이도가 높은 문항부터
  for (let k = 0; used < tot; k++, used++) cnt[order[k % order.length].i]++;
  unp.forEach((r, i) => {
    r.points = Math.round(cnt[i] * unit * 10) / 10;
    r.assigned = true;
  });
}
