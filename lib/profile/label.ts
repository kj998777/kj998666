// 사람 표시용 이름(2026-09-28): 회원가입 때 받은 기수·이름(0021)을 "30기 이은상"처럼 붙여 쓴다.
// 기수·이름이 없는 계정(초대로 만든 계정, 0021 이전 가입자)은 이메일로 대신한다.

/** "30" → "30기", "30기" → "30기", 공백 제거. 빈 값이면 "". */
export function normalizeCohort(raw: string): string {
  const s = String(raw ?? "").replace(/\s+/g, "");
  if (!s) return "";
  return (/^\d+$/.test(s) ? `${s}기` : s).slice(0, 10);
}

export type PersonLike = { display_name?: string | null; cohort?: string | null; email?: string | null };

/** "30기 이은상" / "이은상" / 이메일 */
export function personLabel(p: PersonLike): string {
  const name = [p.cohort, p.display_name].filter((v) => v && String(v).trim()).join(" ");
  return name || p.email || "";
}
