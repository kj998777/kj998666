// 개인정보처리방침·이용약관(2026-09-30 초안, app/privacy · app/terms).
//
// 법률 문서라 원장님이 읽고 확인하신 뒤에만 공개한다. PUBLISHED=false인 동안은
//   - /privacy, /terms 는 관리자에게만 "시행 전 미리보기"로 보이고 다른 사람에게는 404,
//   - 회원가입 화면의 동의 체크도 나오지 않는다.
// 공개할 때: PUBLISHED=true, EFFECTIVE_DATE에 시행일("2026-10-01" 모양)을 적는다.
// 보호책임자 연락처는 공개 저장소에 적지 않고, 계정 관리의 "대기 계정 안내용 카카오톡" 설정(site_contact)을 그대로 보여 준다.
export const LEGAL = {
  PUBLISHED: false,
  EFFECTIVE_DATE: "",
  OPERATOR: "메딕수학",
  OFFICER: "이은상(메딕수학 원장)",
  VERSION: "2026-09-30 초안",
} as const;
