// 과외선생님 검토 포인트 규칙(화면 표시용). 실제 적립은 DB가 한다 — 바꿀 때는 두 곳을 같이 고친다.
//   - 난이도별 기본 포인트: review_points_for_item (0028) — 하·중하·중 1P, 중상·상 2P
//   - 처음 제출 보너스: award_review_points (0043) — 처음 3문항은 +1P

export const FIRST_BONUS_COUNT = 3;
export const FIRST_BONUS_POINTS = 1;

export function basePointsFor(difficulty: string | null | undefined): number {
  return difficulty === "중상" || difficulty === "상" ? 2 : 1;
}
