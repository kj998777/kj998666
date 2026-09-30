// 과외선생님 맞춤 시험지 값 계산(화면 미리보기용 — 실제 차감은 DB 함수 tutor_create_worksheet가 같은 셈으로 한다, 0042).

/** 값(DB 함수 tutor_worksheet_cost와 같은 셈): 시험마다 min(다운로드 가격, 문항 수÷2 올림), 이미 산 시험은 0 */
export function worksheetCost(examIds: string[], price: Record<string, number>): number {
  const n = new Map<string, number>();
  for (const id of examIds) n.set(id, (n.get(id) ?? 0) + 1);
  let sum = 0;
  for (const [id, k] of n) sum += Math.min(price[id] ?? 0, Math.ceil(k / 2));
  return sum;
}
