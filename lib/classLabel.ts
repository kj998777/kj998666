// 반 이름 정리 + "고1 2반" 형태의 학생 화면용 라벨 생성.
// 기존 Apps Script 시스템(clsName_ / clsGrade_ / clsLabel_ / normId_)과 동일한 규칙.

export type Level = "초" | "중" | "고";

export const LEVELS: Level[] = ["초", "중", "고"];

/** 학교급별 학년 수 (초 6개, 중/고 3개씩) */
export const GRADE_COUNT: Record<Level, number> = { 초: 6, 중: 3, 고: 3 };

export function isLevel(v: unknown): v is Level {
  return v === "초" || v === "중" || v === "고";
}

/** 그 학교급에 실제로 존재하는 학년이면 정수로, 아니면 0(무효) */
export function validGrade(level: Level, grade: unknown): number {
  const n = Number(grade);
  return Number.isInteger(n) && n >= 1 && n <= GRADE_COUNT[level] ? n : 0;
}

/**
 * 반 이름 정리: 제어문자·따옴표 등 위험 문자 제거, 공백 정리, 20자 제한.
 * 숫자만 입력하면 뒤에 "반"을 붙인다("2" → "2반").
 */
export function cleanClassName(raw: unknown): string {
  let t = String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f<>|$&"]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20)
    .trim();
  return /^\d+$/.test(t) ? `${t}반` : t;
}

/** 대소문자·공백 무시하고 비교하기 위한 키 (중복 제거용) */
export function classKey(name: string): string {
  return name.replace(/\s+/g, "").toLowerCase();
}

/** 학생 화면·제출 기록에 쓰는 라벨. 예: clsLabel("고", 1, "2반") === "고1 2반" */
export function classLabel(level: Level, grade: number, name: string): string {
  return `${level}${grade} ${name}`;
}
