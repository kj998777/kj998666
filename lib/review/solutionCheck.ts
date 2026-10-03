// 풀이 글의 "결론"이 정답과 다른 문항 찾기(2026-10-03 원장님 제보: 보고서에 "정답: ④ (44)"인데 풀이는 36으로 끝남).
//
// AI가 쓴 풀이는 중간에 계산을 바꾸거나("재계산:", "선지에 맞추어 재검토하면") 마지막 값이 정답표와 다른 채로 남는
// 일이 있다. 여기서는 풀이 끝부분에서 (1) 고른 번호(①~⑤) (2) 마지막 값(수)을 뽑아 정답표·정답 표시와 비교해 의심
// 문항을 고른다. 완벽하지 않으므로 자동으로 고치지 않고 관리자 화면(/admin/solution-check)과 시험 상세 배지에 "확인
// 필요"로만 보여 준다 — 어느 쪽이 맞는지는 사람이 풀어서 정한다. 순수 함수라 test/solutionCheck.test.ts에서 검사한다.

import { mcChoices } from "@/lib/review/mcAnswer";
import { toNumber } from "@/lib/grading";

export type SolutionCheck = {
  /** 풀이 끝에서 읽은 고른 번호("3", "13") — 없으면 "" */
  solChoice: string;
  /** 풀이 끝에서 읽은 마지막 값(글자 그대로) — 없으면 "" */
  solValue: string;
  /** 정답 표시의 괄호 안 값("④ (44)" → "44") 또는 주관식 정답표 값 */
  keyValue: string;
  /** 정답표의 고른 번호(객관식) */
  keyChoice: string;
  /** 풀이 글 자체에 들어 있는 "자신 없음" 표시("재계산", "재확인이 필요", "선지에 맞추어" 등) */
  doubtWords: string[];
  reasons: string[];
  /** 하나라도 걸리면 true */
  flagged: boolean;
};

const DOUBT = [
  "재계산",
  "재확인이 필요",
  "재확인 필요",
  "선지에 맞추어",
  "선지에 맞춰",
  "선택지에 맞추어",
  "정답 선지에",
  "오류가 의심",
  "출제 오류",
  "일치하지 않",
  "모순",
  "다시 확인",
  "불일치",
  "정답과 다르",
  "선지에 없",
  "보기에 없",
];

const CUE = "(?:따라서|그러므로|그래서|∴|정답은|정답:|정답\\s|답은|답:|답\\s|최솟값은|최댓값은|값은|합은|합\\s|개수는|개이다|이므로|이다|즉)";

/** LaTeX·HTML을 걷어내 글자만 남긴다(끝부분 비교용). */
export function plainSolution(s: string): string {
  let t = String(s ?? "");
  t = t.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ");
  t = t.replace(/\\(?:left|right|displaystyle|,|;|!|\s|quad|qquad)/g, "");
  t = t.replace(/\\(?:text|textbf|mathrm|boxed|mathbf)\{([^{}]*)\}/g, "$1");
  for (let i = 0; i < 3; i++) t = t.replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1/$2");
  t = t.replace(/\\sqrt\{([^{}]*)\}/g, "√$1").replace(/\\sqrt\s*(\d+)/g, "√$1");
  t = t
    .replace(/\\therefore/g, "∴")
    .replace(/\\cdot/g, "·")
    .replace(/\\times/g, "×")
    .replace(/\\pi/g, "π")
    .replace(/\\neq?/g, "≠")
    .replace(/\\leq?/g, "≤")
    .replace(/\\geq?/g, "≥")
    .replace(/\\to|\\rightarrow|\\Rightarrow/g, "→")
    .replace(/\\circ/g, "°");
  t = t.replace(/\\[a-zA-Z]+/g, " ").replace(/[${}]/g, "").replace(/\\\(|\\\)|\\\[|\\\]/g, "");
  return t.replace(/\s+/g, " ").trim();
}

/** 풀이 끝부분에서 고른 번호를 읽는다. 단서말(따라서/정답/답) 뒤 25자 안의 원문자를 우선, 없으면 마지막 60자 안의 원문자. */
export function solutionChoice(plain: string): string {
  const tail = plain.slice(-260);
  const re = new RegExp(CUE + "[^①②③④⑤]{0,25}([①②③④⑤](?:\\s*[,·와과및]?\\s*[①②③④⑤])*)", "g");
  let last = "";
  let m: RegExpExecArray | null;
  while ((m = re.exec(tail))) last = m[1];
  if (last) return mcChoices(last);
  const end = plain.slice(-60);
  const circ = end.match(/[①②③④⑤]/g);
  return circ ? mcChoices(circ[circ.length - 1]) : "";
}

/** 풀이 끝부분에서 마지막 값을 읽는다("= 36", "합 36.", "따라서 36", "답은 1/2"). */
export function solutionValue(plain: string): string {
  const tail = plain.slice(-200);
  const num = "(-?\\d+(?:\\.\\d+)?(?:\\s*/\\s*\\d+)?|-?√\\d+|-?\\d*√\\d+(?:\\s*/\\s*\\d+)?)";
  // "= 36", "따라서 36", "따라서 거리는 4√2"(단서말 뒤 짧은 말 허용), "답은 1/2"
  const re = new RegExp("(?:=\\s*|" + CUE + "[^\\d√=-]{0,14}?)\\(?\\s*" + num + "(?=\\s*(?:[.。,)]|이다|입니다|이고|\\(|개|점|$|따라서|그러므로|→|∴|정답|답))", "g");
  let last = "";
  let m: RegExpExecArray | null;
  while ((m = re.exec(tail))) last = m[1];
  return last.replace(/\s+/g, "");
}

/** 정답 표시 "④ (44)" / "④ ($-8$)" → "44" / "-8". 괄호가 없으면 "". */
export function displayValue(answerDisplay: string): string {
  const s = plainSolution(String(answerDisplay ?? ""));
  const m = s.match(/\(\s*([^()]*?)\s*\)\s*$/);
  return m ? m[1].replace(/\s+/g, "") : "";
}

/** 두 값을 비교할 수 있는가: 둘 다 수(분수 포함)이거나 둘 다 √ 꼴일 때만. 글(ㄱ,ㄴ / 식)과 수는 비교하지 않는다(오탐 방지). */
function comparable(a: string, b: string): boolean {
  if (!a || !b) return false;
  const na = toNumber(a);
  const nb = toNumber(b);
  if (na !== null && nb !== null) return true;
  const root = /^-?\d*√\d+(?:\/\d+)?$/;
  return root.test(a) && root.test(b);
}

function sameValue(a: string, b: string): boolean {
  if (a === b) return true;
  const na = toNumber(a);
  const nb = toNumber(b);
  if (na !== null && nb !== null) return Math.abs(na - nb) < 1e-9;
  return a.replace(/\s/g, "") === b.replace(/\s/g, "");
}

export function checkSolution(type: string, keyCell: string, answerDisplay: string, solution: string): SolutionCheck {
  const plain = plainSolution(solution);
  const keyChoice = type === "객관식" ? mcChoices(String(keyCell ?? "").split("|")[0]) : "";
  const keyValue = type === "객관식" ? displayValue(answerDisplay) : plainSolution(String(keyCell ?? "").split("|")[0]).replace(/\s+/g, "");
  const solChoice = type === "객관식" ? solutionChoice(plain) : "";
  const solValue = solutionValue(plain);
  const doubtWords = DOUBT.filter((w) => plain.includes(w));
  const reasons: string[] = [];
  if (!plain.trim()) return { solChoice, solValue, keyValue, keyChoice, doubtWords, reasons, flagged: false };

  if (type === "객관식") {
    if (solChoice && keyChoice && solChoice !== keyChoice) reasons.push(`풀이는 ${circ(solChoice)}로 끝나는데 정답표는 ${circ(keyChoice)}`);
    // 번호가 같으면 값 차이는 보기 내용 표기 차이일 가능성이 커서 보지 않는다. 번호를 못 읽었을 때만 값으로 비교.
    if (!solChoice && comparable(solValue, keyValue) && !sameValue(solValue, keyValue)) reasons.push(`풀이 마지막 값 ${solValue} ≠ 정답 ${keyValue}`);
  } else if (comparable(solValue, keyValue) && !sameValue(solValue, keyValue)) {
    reasons.push(`풀이 마지막 값 ${solValue} ≠ 정답표 ${keyValue}`);
  }
  if (doubtWords.length) reasons.push(`풀이에 "${doubtWords[0]}" 표현`);
  return { solChoice, solValue, keyValue, keyChoice, doubtWords, reasons, flagged: reasons.length > 0 };
}

function circ(choices: string): string {
  const C: Record<string, string> = { "1": "①", "2": "②", "3": "③", "4": "④", "5": "⑤" };
  return choices
    .split("")
    .map((c) => C[c] ?? c)
    .join("");
}
