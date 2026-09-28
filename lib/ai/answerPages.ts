// #7 (2026-09-28): 시험지 PDF 뒤쪽에 붙은 정답·해설·OMR 쪽을 자동으로 찾는다(다운로드 PDF에서 빼기 위해).
//
// AI 문항 추출 때 문항마다 인쇄된 쪽 번호(item_explanations.source_page)를 저장해 두므로, "마지막 문항이
// 있는 쪽" 뒤의 쪽들 = 정답표·해설지·마킹지로 본다(한국 학교 시험지 PDF는 이 순서가 거의 항상 같음).
// 확실하지 않으면 아무것도 빼지 않는다:
//   - 쪽 번호가 있는 문항이 절반도 안 되면(예전 방식으로 처리된 시험 등)
//   - 한 쪽에 문항이 비정상적으로 많이 몰려 있으면(AI가 쪽 번호를 잘못 짚었을 가능성)
//   - 원본을 디지털화 결과로 바꾼 PDF(이미 문제 쪽만 들어 있고 쪽 번호도 달라짐) — 호출하는 쪽에서 처리
// DB에 의존하지 않는 순수 함수라 따로 검증하기 쉽다.

const MAX_ITEMS_PER_PAGE = 14;

export function trailingAnswerPages(sourcePages: (number | null | undefined)[], totalPages: number): number[] {
  if (!Number.isInteger(totalPages) || totalPages < 2 || sourcePages.length === 0) return [];
  const valid = sourcePages.filter((p): p is number => Number.isInteger(p) && (p as number) >= 1 && (p as number) <= totalPages);
  if (valid.length < sourcePages.length * 0.5) return [];
  const maxQ = Math.max(...valid);
  if (maxQ >= totalPages) return [];
  if (sourcePages.length / maxQ > MAX_ITEMS_PER_PAGE) return [];
  const out: number[] = [];
  for (let p = maxQ + 1; p <= totalPages; p++) out.push(p);
  return out;
}

/** 화면 표시용: [7,8,9] → "7~9쪽" */
export function pageRangeLabel(pages: number[]): string {
  if (!pages.length) return "";
  return pages.length === 1 ? `${pages[0]}쪽` : `${pages[0]}~${pages[pages.length - 1]}쪽`;
}
