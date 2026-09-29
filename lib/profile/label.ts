// 사람 표시용 이름(2026-09-28): 회원가입 때 받은 기수·이름(0021)을 "30기 이은상"처럼 붙여 쓴다.
// 기수·이름이 없는 계정(초대로 만든 계정, 0021 이전 가입자)은 이메일로 대신한다.

/** "30" → "30기", "30기" → "30기", 공백 제거. 빈 값이면 "". */
export function normalizeCohort(raw: string): string {
  const s = String(raw ?? "").replace(/\s+/g, "");
  if (!s) return "";
  return (/^\d+$/.test(s) ? `${s}기` : s).slice(0, 10);
}

/** 2026-09-29: 회원가입 "과". 의대는 기수, 나머지는 학번을 받는다(둘 다 profiles.cohort에 저장, 0033). */
export const DEPARTMENTS = ["의대", "수의대", "약대", "간호대"] as const;
export type Department = (typeof DEPARTMENTS)[number];

/** 학번: "21" → "21학번", "2021" → "2021학번", "21학번" 그대로, 더 긴 학번(2021123456)은 숫자 그대로. 빈 값이면 "". */
export function normalizeStudentNo(raw: string): string {
  const s = String(raw ?? "").replace(/\s+/g, "");
  if (!s) return "";
  return (/^\d{2}$|^\d{4}$/.test(s) ? `${s}학번` : s).slice(0, 20);
}

export type PersonLike = { display_name?: string | null; cohort?: string | null; email?: string | null; department?: string | null };

/** "30기 이은상" / "약대 21학번 김약사"(과를 함께 읽은 곳, 의대가 아닐 때만 과 표시) / "이은상" / 이메일 */
export function personLabel(p: PersonLike): string {
  const dept = p.department && p.department !== "의대" ? p.department : "";
  const name = [dept, p.cohort, p.display_name].filter((v) => v && String(v).trim()).join(" ");
  return name || p.email || "";
}
