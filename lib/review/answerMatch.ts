// 정답표(answer_key.correct_answers)와 해설의 정답 표시(item_explanations.answer_display)를 맞춰 보는 순수 함수들.
//
// 2026-10-03 원장님 제보: "해설지에 적혀 있는 답이랑 채점 답이랑 다른 경우가 있음". 채점은 정답표를 쓰고
// 해설지·보고서·학생 화면은 정답 표시(AI나 과외선생님이 적은 "③ ($6$)" 같은 글)를 그대로 보여 줬는데,
// 둘은 따로 수정되는 열이라 어긋날 수 있었다. 이제
//   - 보여 줄 때는 reconcileKeyDisplay()로 정답표와 맞는 경우에만 정답 표시를 쓰고, 다르면 정답표 쪽을 보여 준다
//     (채점 기준이 정답표이므로 학생이 보는 "정답"도 정답표여야 한다).
//   - 저장할 때는 정답표를 고치면 정답 표시도 따라 바꾸고, 정답 표시를 정답표와 다르게 고치는 건 막는다
//     (app/(staff)/exams/[code]/actions.ts).
// 이 파일은 "server-only"가 아니라서 보고서 PDF(브라우저에서 만듦)에서도 쓴다. 서버 전용 흐름은 lib/review/confirm.ts.

import { isCorrect } from "@/lib/grading";
import { mcDigitOf, shortAnswerOf } from "@/lib/ai/normalize";
import { mcChoices, mcMatchesKeyCell } from "@/lib/review/mcAnswer";

const CIRC: Record<string, string> = { "1": "①", "2": "②", "3": "③", "4": "④", "5": "⑤" };

/**
 * 과외선생님이 적은 정답 표시(①, "$\\frac{1}{2}$", "x=3" 등)를 정답표(answer_key.correct_answers)
 * 비교·저장용 문자열로 바꾼다. 완벽한 변환은 아니며, 못 맞추면 관리자가 검토현황에서 직접 고친다.
 */
export function toKeyAnswer(type: string, s: string): string {
  const raw = String(s ?? "");
  if (type === "객관식") {
    // 2026-09-30: "①③"이 "1"로, "④ 12"가 엉뚱하게 바뀌던 것 → 고른 번호 모음으로(lib/review/mcAnswer.ts)
    const c = mcChoices(raw);
    if (c) return c;
    const d = mcDigitOf(raw);
    if (d) return d;
  }
  let t = shortAnswerOf(raw);
  const simple = (x: string) => /^-?[0-9a-zA-Z.]+$/.test(x);
  t = t
    .replace(/\\left|\\right/g, "")
    .replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, (_m, a, b) =>
      simple(a) && simple(b) ? `${a}/${b}` : `(${a})/(${b})`
    )
    .replace(/\\sqrt\{([^{}]*)\}/g, "√($1)")
    .replace(/\\pi/g, "π")
    .replace(/\\times/g, "×")
    .replace(/\\cdot/g, "·")
    .replace(/\\leq?/g, "≤")
    .replace(/\\geq?/g, "≥")
    .replace(/\\[,;!]|\\ /g, "")
    .replace(/[{}]/g, "");
  return t.trim().slice(0, 100);
}

/** 과외선생님 답(정답 표시)이 정답표와 같은가. */
export function tutorAnswerMatches(type: string, tutorAnswer: string, keyCell: string): boolean {
  if (!tutorAnswer || !keyCell) return false;
  // 객관식은 모양("④"·"4번"·"④ 12"·"$4$")이 달라도 고른 번호가 같으면 같은 답(2026-09-30 제보: 번호가 같은데 "AI와 다름")
  if (type === "객관식") {
    const m = mcMatchesKeyCell(tutorAnswer, keyCell);
    if (m !== null) return m;
  }
  return isCorrect(toKeyAnswer(type, tutorAnswer), keyCell, type) || isCorrect(tutorAnswer, keyCell, type);
}

/** 정답표 칸("3", "24", "3|4", "1/2")을 읽기 좋게: 객관식은 ③·②④, 여러 정답은 " 또는 ". */
export function formatKey(type: string, keyCell: string): string {
  const alts = String(keyCell ?? "")
    .split("|")
    .map((x) => x.trim())
    .filter(Boolean);
  return alts
    .map((x) => (type === "객관식" && /^[1-5]+$/.test(x) ? x.split("").map((c) => CIRC[c]).join("") : x))
    .join(" 또는 ");
}

export type KeyDisplay = {
  /** 화면·PDF에 "정답"으로 보여 줄 글(수식 $…$ 포함 가능). 정답표가 비어 있으면 "". */
  text: string;
  /** 정답 표시가 정답표와 다른가(= 정답표 쪽을 보여 주고 있음). 정답 표시가 비어 있으면 false. */
  mismatch: boolean;
};

/**
 * 보여 줄 "정답"을 정한다 — 정답표와 같을 때만 정답 표시(예: "③ ($6$)")를 쓰고, 다르거나 비어 있으면 정답표를 쓴다.
 * 정답표가 비어 있으면(정답 미등록) 정답 표시라도 보여 준다.
 */
export function reconcileKeyDisplay(type: string, keyCell: string | null | undefined, answerDisplay: string | null | undefined): KeyDisplay {
  const key = String(keyCell ?? "").trim();
  const disp = String(answerDisplay ?? "").trim();
  if (!key) return { text: disp, mismatch: false };
  if (!disp) return { text: formatKey(type, key), mismatch: false };
  if (tutorAnswerMatches(type, disp, key)) return { text: disp, mismatch: false };
  // 2026-10-03 오탐 줄이기: 정답표 칸을 그대로 적은 표시("√2/8|(√2)/8"), HTML로 이스케이프된 표시("&lt;UNKNOWN&gt;"),
  // 주관식에서 "a=3"처럼 문자를 붙여 적은 표시는 같은 답으로 본다.
  const unesc = disp.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  if (unesc === key) return { text: disp, mismatch: false };
  if (type !== "객관식") {
    const rhs = unesc.replace(/^\$?\s*[a-zA-Z](?:\([a-zA-Z0-9]+\))?\s*=\s*/, "").replace(/^\$/, "");
    if (rhs !== unesc && tutorAnswerMatches(type, rhs.startsWith("$") || !unesc.startsWith("$") ? rhs : "$" + rhs, key)) return { text: disp, mismatch: false };
  }
  return { text: formatKey(type, key), mismatch: true };
}
