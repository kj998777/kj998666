// 과외선생님 검토 배정 순서의 "제주 급" 판단 — DB public.review_jeju_level(0044)과 같은 규칙. 바꿀 때는 두 곳을 같이 고친다.
// 2026-10-01 원장님 요청: 공통수학1·2(2022 개정 교육과정 고1)는 처음 시험이 2025년이라 그 전 제주 기출이 없으므로,
// 다른 지역 학교 시험이어도 제주 학교 시험과 같은 순위로 먼저 배정한다.

export const NEW_CURRICULUM_RE = /공통\s*수학\s*(1|2|Ⅰ|Ⅱ|I)/;

export function isNewCurriculumExam(name: string | null | undefined): boolean {
  return NEW_CURRICULUM_RE.test(String(name ?? ""));
}

/** 배정 순서에서 제주 시험과 같은 칸인지 */
export function reviewJejuLevel(exam: { is_jeju?: boolean | null; name?: string | null }): boolean {
  return !!exam.is_jeju || isNewCurriculumExam(exam.name);
}
