// 정답률 기록 다시 맞추기(2026-09-30) — 계획만 세우는 부분(DB 없이 시험할 수 있게 비교 함수를 받는다).
//
// 배경: 객관식 답을 "④"·"4번"·"④ 12"처럼 다르게 적으면 예전 비교 함수가 다른 답으로 봐서, 맞게 푼 선생님이
// "틀림"으로 기록된 경우가 있다(lib/review/mcAnswer.ts로 고침). 이미 쌓인 tutor_judgments 중
// "틀림"인데 지금 비교 함수로는 확정 정답과 같은 것만 "맞음"으로 바꾼다. 반대 방향(맞음→틀림)은 건드리지 않는다
// — 그쪽은 이번 버그와 상관이 없고, 원장님이 직접 정한 기록을 뒤집을 수 있어서.

export type JudgmentRow = {
  id: string;
  tutorId: string;
  correct: boolean;
  source: string;
  kind: "review" | "gold";
  refId: string; // review_id 또는 gold_attempt_id
};

export type AnswerOf = {
  answer: string; // 선생님이 낸 답
  type: string; // 객관식/주관식
  keyCell: string | null; // 확정된 정답표 칸(없으면 null)
  confirmed: boolean; // 문항이 확정됐는가(정답 아는 문항은 늘 true로 넘긴다)
};

export type RejudgePlan = {
  checked: number; // 살펴본 "틀림" 기록
  flips: { id: string; tutorId: string; kind: "review" | "gold"; refId: string }[];
  skippedUnconfirmed: number; // 아직 확정 전이라 그대로 둔 것
  byTutor: Record<string, number>;
};

export function planRejudge(
  rows: JudgmentRow[],
  lookup: (r: JudgmentRow) => AnswerOf | null,
  matches: (type: string, answer: string, keyCell: string) => boolean
): RejudgePlan {
  const plan: RejudgePlan = { checked: 0, flips: [], skippedUnconfirmed: 0, byTutor: {} };
  for (const r of rows) {
    if (r.correct) continue;
    plan.checked++;
    const a = lookup(r);
    if (!a || !a.keyCell || !a.answer) continue;
    if (!a.confirmed) {
      plan.skippedUnconfirmed++;
      continue;
    }
    if (matches(a.type, a.answer, a.keyCell)) {
      plan.flips.push({ id: r.id, tutorId: r.tutorId, kind: r.kind, refId: r.refId });
      plan.byTutor[r.tutorId] = (plan.byTutor[r.tutorId] ?? 0) + 1;
    }
  }
  return plan;
}
