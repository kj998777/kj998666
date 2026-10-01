// 2026-10-01 원장님 요청 "홍보배너 문구 만들기 및 메딕수학 홍보사이트와 블로그 링크 연결".
// 메딕차트에서 학원 학생·학부모가 보는 곳(학생 답 제출 완료 화면, 학원 보고서 PDF)에 메딕수학 홍보 배너를 붙인다.
// 과외선생님 링크·과외선생님 입학테스트로 들어온 학생(과외선생님의 학생)에게는 붙이지 않는다.
// 문구는 홍보사이트(medicmath-site) 첫 화면과 같은 말("결심한 학생만 받습니다")을 쓴다. 바꾸려면 여기 한 곳만.

export const PROMO = {
  name: "메딕수학",
  headline: "결심한 학생만 받습니다",
  sub: "제주시 중·고등 수학 전문 · 학교 기출을 한 문제씩 직접 풀어 정리한 메딕차트로, 어디서 점수가 새는지 찾아 드립니다.",
  siteUrl: "https://medicmath-site.vercel.app",
  applyUrl: "https://medicmath-site.vercel.app/#consult",
  blogUrl: "https://blog.naver.com/yijean",
  phone: "064-702-3455",
  address: "제주시 중앙로 312",
} as const;

/** 주소를 화면에 보일 때(https:// 빼고) */
export const shortUrl = (u: string) => u.replace(/^https?:\/\//, "").replace(/\/$/, "");

/** 보고서 PDF 맨 끝 홍보 상자(.rpt 양식) — PDF는 그림으로 만들어 링크를 누를 수 없으므로 주소를 글로 적는다 */
export function promoReportHtml(): string {
  return (
    `<div class="rpt-box" style="margin-top:10px;border-color:#fecdd3;background:#fff1f2">` +
    `<b style="color:#be123c">${PROMO.name}</b> — ${PROMO.headline}. ${PROMO.sub}<br>` +
    `<span class="rpt-small">홈페이지 ${shortUrl(PROMO.siteUrl)} · 블로그 ${shortUrl(PROMO.blogUrl)} · 상담 ${PROMO.phone} · ${PROMO.address}</span>` +
    `</div>`
  );
}
