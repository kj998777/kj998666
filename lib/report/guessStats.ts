// 2026-10-01 원장님 요청 "찍음 통계 넓히기": 학생이 "찍음"으로 표시한 문항을 반 전체로 모아 본다.
// 찍은 학생이 많은 문항 = 학생들이 확신하지 못한 문항 = 수업에서 다시 다룰 문항. 순수 계산(test/guessStats.test.ts).

type P = { item_label: string; correct?: boolean; guessed?: boolean };

export type GuessItemStat = {
  label: string;
  /** 제출한 학생 수 */
  n: number;
  /** 찍음으로 표시한 학생 수 */
  guessed: number;
  /** 그중 맞힌 학생 수 */
  guessedCorrect: number;
  /** 맞힌 학생 수(찍어서 맞힌 학생 포함) */
  correct: number;
  /** 확실히 맞힌 학생 수(찍어서 맞힌 학생 뺌) */
  realCorrect: number;
};

export function guessStatsByItem(perItems: (P[] | null | undefined)[], labels?: string[]): GuessItemStat[] {
  const order: string[] = labels ? [...labels] : [];
  const by = new Map<string, GuessItemStat>();
  const get = (label: string) => {
    let s = by.get(label);
    if (!s) {
      s = { label, n: 0, guessed: 0, guessedCorrect: 0, correct: 0, realCorrect: 0 };
      by.set(label, s);
      if (!order.includes(label)) order.push(label);
    }
    return s;
  };
  for (const l of order) get(l);
  for (const per of perItems) {
    for (const p of per ?? []) {
      const s = get(String(p.item_label));
      s.n++;
      if (p.guessed) s.guessed++;
      if (p.correct) {
        s.correct++;
        if (p.guessed) s.guessedCorrect++;
        else s.realCorrect++;
      }
    }
  }
  return order.map((l) => by.get(l)!).filter(Boolean);
}

export type GuessTotals = {
  /** 제출한 학생 수 */
  students: number;
  /** 찍음을 한 번이라도 표시한 학생 수 */
  studentsGuessed: number;
  /** 찍음 표시 건수(학생×문항) */
  marks: number;
  /** 그중 맞힌 건수 */
  marksCorrect: number;
};

export function guessTotals(perItems: (P[] | null | undefined)[]): GuessTotals {
  let studentsGuessed = 0;
  let marks = 0;
  let marksCorrect = 0;
  for (const per of perItems) {
    const g = (per ?? []).filter((p) => p.guessed);
    if (g.length) studentsGuessed++;
    marks += g.length;
    marksCorrect += g.filter((p) => p.correct).length;
  }
  return { students: perItems.length, studentsGuessed, marks, marksCorrect };
}

/** 다시 가르칠 문항: 제출한 학생의 30% 이상(그리고 2명 이상)이 찍었다고 표시한 문항, 찍은 학생이 많은 순 */
export function manyGuessed(stats: GuessItemStat[], share = 0.3): GuessItemStat[] {
  return stats
    .filter((s) => s.n > 0 && s.guessed >= 2 && s.guessed / s.n >= share)
    .sort((a, b) => b.guessed / b.n - a.guessed / a.n || b.guessed - a.guessed || a.label.localeCompare(b.label, "ko", { numeric: true }));
}

export const pctOf = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
