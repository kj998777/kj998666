// 제주특별자치도 중·고등학교 목록과, 시험 이름에서 "제주 학교" 여부를 알아내는 도우미.
// 검토 문항 배정 우선순위(제주 학교 문제 > 타 지역 문제)에 쓴다(supabase/migrations/0019).
//
// 목록 출처(2026-09-28 확인): 위키백과 "제주특별자치도의 고등학교/중학교 목록", 나무위키 "제주특별자치도의
// 중학교 목록", k2man.net 제주 고등학교 목록. 학교가 새로 생기거나 이름이 바뀌면 여기에 더하면 된다
// (DB의 기존 시험은 시험 상세 화면의 "제주 학교" 체크로 직접 바꿀 수 있음).
//
// 시험 이름에는 보통 "대기고", "제주여고", "신성여중"처럼 줄임말이 들어가므로, 정식 이름에서 줄임말을
// 만들어 함께 비교한다. "중앙고", "제일고"처럼 다른 지역에도 흔한 이름은 "제주" 없이는 비교하지 않는다
// (정식 이름이 "제주"로 시작하는 학교는 "제주"를 뗀 줄임말을 만들지 않음).

export const JEJU_HIGH_SCHOOLS = [
  "남녕고등학교", "대기고등학교", "세화고등학교", "신성여자고등학교", "애월고등학교", "영주고등학교",
  "오현고등학교", "제주고등학교", "제주과학고등학교", "제주대학교사범대학부설고등학교", "제주여자고등학교",
  "제주여자상업고등학교", "제주외국어고등학교", "제주제일고등학교", "제주중앙고등학교", "제주중앙여자고등학교",
  "한국뷰티고등학교", "한림고등학교", "한림공업고등학교", "함덕고등학교", "남주고등학교", "대정고등학교",
  "대정여자고등학교", "삼성여자고등학교", "서귀포고등학교", "서귀포산업과학고등학교", "서귀포여자고등학교",
  "성산고등학교", "중문고등학교", "표선고등학교",
];

export const JEJU_MIDDLE_SCHOOLS = [
  "고산중학교", "귀일중학교", "김녕중학교", "노형중학교", "세화중학교", "신성여자중학교", "신엄중학교",
  "신창중학교", "아라중학교", "애월중학교", "오름중학교", "오현중학교", "우도중학교", "저청중학교",
  "제주대학교사범대학부설중학교", "제주동여자중학교", "제주동중학교", "제주서중학교", "제주여자중학교",
  "제주제일중학교", "제주중앙여자중학교", "제주중앙중학교", "제주중학교", "조천중학교", "추자중학교",
  "탐라중학교", "한라중학교", "한림여자중학교", "한림중학교", "함덕중학교", "남원중학교", "남주중학교",
  "대정중학교", "무릉중학교", "서귀중앙여자중학교", "서귀포대신중학교", "서귀포여자중학교", "서귀포중학교",
  "성산중학교", "신산중학교", "안덕중학교", "위미중학교", "중문중학교", "표선중학교", "효돈중학교",
];

const SHORTEN: [RegExp, string][] = [
  [/대학교사범대학부설/g, "사대부"],
  [/산업과학/g, "산과"],
  [/여자상업/g, "여상"],
  [/외국어/g, "외"],
  [/공업/g, "공"],
  [/과학/g, "과"],
  [/여자/g, "여"],
  [/고등학교$/, "고"],
  [/중학교$/, "중"],
];

function aliasesOf(full: string): string[] {
  const out = new Set<string>([full]);
  let s = full;
  for (const [re, to] of SHORTEN) s = s.replace(re, to);
  out.add(s); // 예: 제주여자고등학교 → 제주여고, 제주대학교사범대학부설고등학교 → 제주사대부고
  // 자주 쓰는 다른 줄임말
  if (s.endsWith("사대부고")) out.add(s.replace("사대부고", "대사대부고"));
  if (s.endsWith("여상고")) out.add(s.slice(0, -1)); // 제주여상
  if (s === "서귀포여고") out.add("서귀여고");
  if (s === "서귀포산과고") out.add("서귀포산업과학고");
  return Array.from(out);
}

export const JEJU_HIGH_ALIASES = Array.from(new Set(JEJU_HIGH_SCHOOLS.flatMap(aliasesOf)));
export const JEJU_MIDDLE_ALIASES = Array.from(new Set(JEJU_MIDDLE_SCHOOLS.flatMap(aliasesOf)));

/** 시험 이름에서 제주 학교 여부와 학교급(알 수 있으면)을 알아낸다. */
export function detectJejuSchool(examName: string): { jeju: boolean; level: "고" | "중" | null } {
  const name = String(examName ?? "").replace(/\s+/g, "");
  // 긴 이름부터 비교해야 "제주여고"가 "제주고"로 잘못 걸리지 않는다(둘 다 제주 학교라 결과는 같지만 학교급 판단용).
  const all: [string, "고" | "중"][] = [
    ...JEJU_HIGH_ALIASES.map((a) => [a, "고"] as [string, "고"]),
    ...JEJU_MIDDLE_ALIASES.map((a) => [a, "중"] as [string, "중"]),
  ].sort((x, y) => y[0].length - x[0].length);
  for (const [alias, level] of all) {
    if (name.includes(alias)) return { jeju: true, level };
  }
  return { jeju: false, level: null };
}
