// 채점 정규화·비교 로직.
//
// 기존 Apps Script 시스템(Code.gs 의 normAnswer_ / toNumber_ / isCorrect_)을 그대로 이식한
// 순수 함수 모음. DB·네트워크에 전혀 의존하지 않으므로 test/grading.test.ts 에서 이 파일만
// 불러와 node로 바로 검증할 수 있다.
//
// 동치 처리 목록(원본과 동일):
//   - 원문자 ①~⑨ → 1~9
//   - 전각(！~～) → 반각
//   - 유니코드 마이너스(−–—－) → -
//   - 공백·쉼표 제거, 대소문자 무시
//   - ² → ^2, ³ → ^3, ** → ^
//   - sqrt / 루트 / √ → √ 로 통일, √(3) → √3
//   - ×·⋅ → *, ÷ → /
//   - pi → π
//   - >= → ≥, <= → ≤
//   - 분수·소수 수치 동치(3/4 = 0.75 = 6/8), 절대오차 1e-9 이내
//   - 정답 여러 개는 "|" 로 구분, 하나라도 맞으면 정답
//   - (2026-09-29 추가) 객관식에서 답을 여러 개 고르는 문항은 순서를 따지지 않음: 정답 "3,5"(③⑤)에 "5,3"도 정답.
//     객관식이고 양쪽이 모두 선택지 번호(1~9)로만 이뤄졌을 때만 적용한다.
//   - (2026-09-29 추가) 수식으로 적은 답: $\\frac{3}{4}$ → 3/4, \\sqrt{2} → √2, \\le → ≤ 등(latexToPlain)

const CIRCLED: Record<string, string> = {
  "①": "1",
  "②": "2",
  "③": "3",
  "④": "4",
  "⑤": "5",
  "⑥": "6",
  "⑦": "7",
  "⑧": "8",
  "⑨": "9",
};

/**
 * (2026-09-29) 수식으로 적은 답($\frac{3}{4}$, \sqrt{2}, x \le 3 …)을 평범한 글(3/4, √2, x≤3)로 바꾼다.
 * 관리자·과외선생님이 수식 버튼(app/_components/MathTools.tsx)으로 정답을 적으면 이 모양이 들어오므로,
 * 채점 비교 전에 학생이 치는 모양과 같게 맞춘다. $ 나 \ 가 없으면 그대로 돌려준다.
 */
export function latexToPlain(input: unknown): string {
  let s = String(input ?? "");
  if (!/[\\$]/.test(s)) return s;
  const simple = (x: string) => /^-?[0-9a-zA-Z.√π]+$/.test(x);
  s = s
    .replace(/\$/g, "")
    .replace(/\\left|\\right|\\displaystyle/g, "")
    .replace(/\\(?:text|mathrm|mathbf|operatorname)\{([^{}]*)\}/g, "$1");
  // 안쪽부터 여러 번(분수 안의 루트, 분수 안의 분수)
  for (let k = 0; k < 6; k++) {
    const before = s;
    s = s
      .replace(/\\sqrt\[([^[\]{}]*)\]\{([^{}]*)\}/g, (_m, n, x) => `√[${n}](${x})`)
      .replace(/\\sqrt\{([^{}]*)\}/g, (_m, x) => (simple(x) ? `√${x}` : `√(${x})`))
      .replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, (_m, a, b) => `${simple(a) ? a : `(${a})`}/${simple(b) ? b : `(${b})`}`);
    if (s === before) break;
  }
  s = s
    .replace(/\^\{\\circ\}|\\circ/g, "°")
    .replace(/\\pi(?![a-zA-Z])/g, "π")
    .replace(/\\times(?![a-zA-Z])/g, "×")
    .replace(/\\cdot(?![a-zA-Z])/g, "·")
    .replace(/\\div(?![a-zA-Z])/g, "÷")
    .replace(/\\(?:leq|le)(?![a-zA-Z])/g, "≤")
    .replace(/\\(?:geq|ge)(?![a-zA-Z])/g, "≥")
    .replace(/\\(?:neq|ne)(?![a-zA-Z])/g, "≠")
    .replace(/\\pm(?![a-zA-Z])/g, "±")
    .replace(/\\infty(?![a-zA-Z])/g, "∞")
    .replace(/\\alpha(?![a-zA-Z])/g, "α")
    .replace(/\\beta(?![a-zA-Z])/g, "β")
    .replace(/\\theta(?![a-zA-Z])/g, "θ")
    .replace(/\\angle(?![a-zA-Z])/g, "∠")
    .replace(/\\triangle(?![a-zA-Z])/g, "△")
    .replace(/\^\{([^{}]*)\}/g, "^$1")
    .replace(/_\{([^{}]*)\}/g, "_$1")
    .replace(/\\[,;:! ]/g, "")
    .replace(/[{}]/g, "")
    .replace(/\\/g, "");
  return s.trim();
}

export function normalizeAnswer(input: unknown): string {
  let s = latexToPlain(input);
  s = s.replace(/[①-⑨]/g, (c) => CIRCLED[c] ?? c);
  s = s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  s = s.replace(/[−–—－]/g, "-");
  s = s.replace(/[\s,]/g, "");
  s = s.toLowerCase();
  s = s.replace(/²/g, "^2").replace(/³/g, "^3");
  s = s.replace(/\*\*/g, "^");
  s = s.replace(/sqrt|루트|√/g, "√");
  s = s.replace(/√\(([a-z0-9.]+)\)/g, "√$1");
  s = s.replace(/[×·⋅]/g, "*").replace(/÷/g, "/");
  s = s.replace(/pi/g, "π");
  s = s.replace(/>=/g, "≥").replace(/<=/g, "≤");
  // (2026-09-29) 분수의 위·아래를 감싼 괄호가 한 덩어리뿐이면 뺀다: (√3)/(2) → √3/2
  s = s.replace(/\(([a-z0-9.√π^]+)\)(?=\/)/g, "$1").replace(/\/\(([a-z0-9.√π^]+)\)/g, "/$1");
  return s;
}

/** "3/4" 같은 분수나 정수/소수를 숫자로 바꾼다. 분수·숫자가 아니면 null. */
export function toNumber(s: string): number | null {
  const frac = /^(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(s);
  if (frac) {
    const d = parseFloat(frac[2]);
    return d === 0 ? null : parseFloat(frac[1]) / d;
  }
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return parseFloat(s);
  return null;
}

/**
 * given(학생 답)이 keyCell(정답, "|"로 여러 개 구분 가능)과 동치인지 판정.
 * 빈 답은 항상 오답 처리.
 */
export function isCorrect(given: unknown, keyCell: unknown, type?: string): boolean {
  const g = normalizeAnswer(given);
  if (g === "") return false;
  const accepted = String(keyCell ?? "").split("|");
  const sortChars = (x: string) => x.split("").sort().join("");
  for (const raw of accepted) {
    const a = normalizeAnswer(raw);
    if (a === "") continue;
    if (g === a) return true;
    if (type === "객관식" && /^[1-9]{2,}$/.test(g) && /^[1-9]{2,}$/.test(a) && sortChars(g) === sortChars(a)) return true;
    const gn = toNumber(g);
    const an = toNumber(a);
    if (gn !== null && an !== null && Math.abs(gn - an) < 1e-9) return true;
  }
  return false;
}

export type AnswerKeyItem = {
  item_label: string;
  correct_answers: string;
  points: number;
  type: "객관식" | "주관식";
};

export type PerItemResult = {
  item_label: string;
  given: string;
  correct: boolean;
  points: number;
};

export type GradingOutcome = {
  perItem: PerItemResult[];
  totalScore: number;
};

/**
 * 문항 순서대로 학생 답안(answers) 을 채점한다.
 * answers.length 는 key.length 와 같아야 하며, 맞지 않으면 예외를 던진다
 * (호출자가 "문항 수가 맞지 않습니다" 같은 메시지로 바꿔서 응답해야 함).
 */
export function gradeSubmission(key: AnswerKeyItem[], answers: unknown[]): GradingOutcome {
  if (answers.length !== key.length) {
    throw new Error(`answers length (${answers.length}) !== key length (${key.length})`);
  }
  let total = 0;
  const perItem: PerItemResult[] = key.map((k, i) => {
    const given = String(answers[i] ?? "").slice(0, 200);
    const correct = isCorrect(given, k.correct_answers, k.type);
    if (correct) total += k.points;
    return { item_label: k.item_label, given, correct, points: correct ? k.points : 0 };
  });
  // 3.6 + 3.7 같은 소수 합의 부동소수점 오차 제거(원본과 동일하게 소수 둘째 자리에서 반올림)
  total = Math.round(total * 100) / 100;
  return { perItem, totalScore: total };
}
