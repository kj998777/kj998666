// 학생 제출 직후 화면에 보여 줄 내 결과(2026-10-11 원장님 "학생 제출 화면에서도 점수 및 어떤 문제 틀렸고 이런 통계 결과는
// 볼 수 있게 — 해설은 못 보게"). 정답·풀이는 넣지 않는다(아직 다른 학생이 풀고 있을 수 있음): 점수, 맞힌 수, 틀린·무응답
// 문항 번호, 찍어서 맞힌 문항, 영역별·배점별 결과, (고3 모의고사에 예상 등급컷이 있으면) 예상 등급만.
// DB·네트워크를 쓰지 않는 순수 계산 — 제출 API(app/api/submit/[code])가 채점 직후 부른다(test/studentResult.test.ts).

import { CHOICES, choiceOfLabel, displayNo, expectedGrade, mockItemMeta, type ChoiceKey, type GradeCuts } from "@/lib/exams/mockCsat";

type KeyLike = { item_label: string; points: number | string };
type PerItemLike = { item_label: string; given: string; correct: boolean; guessed?: boolean };

export type StudentResult = {
  total: number;
  max: number;
  /** 맞힌 문항 수 / 전체 문항 수 */
  correct: number;
  n: number;
  /** 화면에 보일 번호("23" — 선택과목 머리말은 뺌) */
  wrong: string[];
  blank: string[];
  guessedRight: string[];
  areas: { area: string; earned: number; total: number }[];
  byPoints: { points: number; correct: number; n: number }[];
  grade: { label: string; choice: string; cuts: number[] } | null;
};

const round2 = (x: number) => Math.round(x * 100) / 100;

export function buildStudentResult(
  key: KeyLike[],
  perItem: PerItemLike[],
  opts: { totalScore: number; areaOf?: Record<string, string>; gradeCuts?: GradeCuts; choice?: ChoiceKey | null } = { totalScore: 0 }
): StudentResult {
  const pts = new Map(key.map((k) => [String(k.item_label), Number(k.points) || 0]));
  const mock = key.some((k) => choiceOfLabel(String(k.item_label)) !== null);
  const show = (label: string) => displayNo(label);
  const wrong: string[] = [];
  const blank: string[] = [];
  const guessedRight: string[] = [];
  const areaMap = new Map<string, { earned: number; total: number }>();
  const pointMap = new Map<number, { correct: number; n: number }>();
  let correct = 0;
  let max = 0;
  for (const p of perItem) {
    const label = String(p.item_label);
    const points = pts.get(label) ?? 0;
    max += points;
    if (p.correct) {
      correct++;
      if (p.guessed) guessedRight.push(show(label));
    } else if (String(p.given ?? "").trim() === "") blank.push(show(label));
    else wrong.push(show(label));
    const area = mock ? mockItemMeta(label, points).area : (opts.areaOf?.[label] ?? "").trim();
    if (area) {
      const a = areaMap.get(area) ?? { earned: 0, total: 0 };
      a.total += points;
      if (p.correct) a.earned += points;
      areaMap.set(area, a);
    }
    const b = pointMap.get(points) ?? { correct: 0, n: 0 };
    b.n++;
    if (p.correct) b.correct++;
    pointMap.set(points, b);
  }
  let grade: StudentResult["grade"] = null;
  const cuts = opts.choice ? opts.gradeCuts?.[opts.choice] : undefined;
  const g = expectedGrade(opts.totalScore, cuts);
  if (g && cuts) grade = { label: g.label, choice: CHOICES.find((c) => c.key === opts.choice)?.name ?? "", cuts };
  return {
    total: round2(opts.totalScore),
    max: round2(max),
    correct,
    n: perItem.length,
    wrong,
    blank,
    guessedRight,
    areas: Array.from(areaMap.entries()).map(([area, v]) => ({ area, earned: round2(v.earned), total: round2(v.total) })),
    byPoints: Array.from(pointMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([points, v]) => ({ points, ...v })),
    grade,
  };
}
