// 시험 이름에서 학교 이름을 뽑는다(옛 학교별 기출 탭의 schoolOf() 흉내).
// "…고" / "…고등학교" 형태의 토큰을 찾되, 괄호 밖 텍스트를 먼저 보고 없으면 괄호 안을 본다.
// 둘 다 없으면 "학교 미상". 직원 시험 목록(ExamFolderTree)과 기출 스토어(StoreFolderTree)가 같이 쓴다.

// 같은 학교를 가리키는 다른 표기를 하나로 합치는 표 — 필요할 때마다 항목을 추가하면 된다.
const SCH_ALIAS: Record<string, string> = {
  제주제일고: "제주일고",
  제주중앙여자고: "제주중앙여고",
};

function normalizeSchool(raw: string): string {
  const s = raw.replace(/고등학교$/, "고");
  return SCH_ALIAS[s] ?? s;
}

export function schoolOf(name: string): string {
  const parenMatch = name.match(/\(([^)]*)\)/);
  const outside = parenMatch ? name.replace(parenMatch[0], "") : name;
  const inside = parenMatch ? parenMatch[1] : "";
  for (const text of [outside, inside]) {
    const m = text.match(/[가-힣]{2,20}(고등학교|고)(?![가-힣])/);
    if (m) return normalizeSchool(m[0]);
  }
  return "학교 미상";
}
