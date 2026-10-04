// 2026-10-01 원장님 요청 "홍보배너 문구 만들기 및 메딕수학 홍보사이트와 블로그 링크 연결".
// 메딕차트에서 학원 학생·학부모가 보는 곳(학생 답 제출 완료 화면, 학원 보고서 PDF)에 메딕수학 홍보 배너를 붙인다.
// 2026-10-01 원장님: 과외선생님 링크·과외선생님 입학테스트로 들어온 학생에게도 똑같이 붙인다(학원·과외 구분 없음).
// 문구는 홍보사이트(medicmath-site) 첫 화면과 같은 말("결심한 학생과 함께합니다")을 쓴다. 바꾸려면 여기 한 곳만.

export const PROMO = {
  name: "메딕수학",
  headline: "결심한 학생과 함께합니다",
  sub: "제주시 중·고등 수학 전문 · 학교 기출을 한 문제씩 직접 풀어 정리한 메딕차트로, 어디서 점수가 새는지 찾아 드립니다.",
  siteUrl: "https://www.medicmath.com",
  applyUrl: "https://www.medicmath.com/#consult",
  blogUrl: "https://blog.naver.com/yijean",
  phone: "064-702-3455",
  address: "제주시 중앙로 312",
  /** 학원 로고(601×116, 메딕차트 머리글·로그인 화면과 같은 파일) */
  logoSrc: "/academy-logo.png",
} as const;

// 2026-10-01 원장님: 배너에 학원 로고와 메딕차트 로고도 — 메딕차트 머리글처럼 "[+]메딕차트 | 메딕수학 로고".
// PDF는 html2canvas로 그리므로 메딕차트 표시(.brand-mark의 ::before)를 인라인 스타일 글자로 다시 만든다(색 brand-700 #832f1d).
export function promoLogosHtml(): string {
  return (
    `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">` +
    `<span style="display:inline-flex;align-items:center;gap:6px;font-weight:700;color:#1C1A16;font-size:15px">` +
    `<span style="display:inline-flex;align-items:center;justify-content:center;width:17px;height:17px;border-radius:4px;background:#832f1d;color:#fff;font-weight:800;font-size:13px;line-height:1">+</span>메딕차트</span>` +
    `<span style="display:inline-block;width:1px;height:18px;background:#D6CFC4"></span>` +
    `<img src="${PROMO.logoSrc}" alt="${PROMO.name}" style="height:24px;width:124px">` +
    `</div>`
  );
}

/** 주소를 화면에 보일 때(https:// 빼고) */
export const shortUrl = (u: string) => u.replace(/^https?:\/\//, "").replace(/\/$/, "");

/** 보고서 PDF 맨 끝 홍보 상자(.rpt 양식) — PDF는 그림으로 만들어 링크를 누를 수 없으므로 주소를 글로 적는다 */
export function promoReportHtml(): string {
  return (
    `<div class="rpt-box" style="margin-top:10px;border-color:#E8C4C0;background:#F8ECEA">` +
    promoLogosHtml() +
    `<b style="color:#8A2A2A">${PROMO.name}</b> — ${PROMO.headline}. ${PROMO.sub}<br>` +
    `<span class="rpt-small">홈페이지 ${shortUrl(PROMO.siteUrl)} · 블로그 ${shortUrl(PROMO.blogUrl)} · 상담 ${PROMO.phone} · ${PROMO.address}</span>` +
    `</div>`
  );
}
