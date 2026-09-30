// 디지털화 숫자 오류 자동 찾기(2026-09-30 원장님 요청 — "숫자를 잘못 읽은 문항을 한 문항씩 찾기 힘들다").
//
// 같은 스캔본을 AI가 두 번 따로 읽는다: ① 처음 자동 처리 때 문제 요약(item_explanations.problem_statement)·풀이·정답,
// ② 디지털화 때 옮겨 적은 글(digitized_pages). 두 읽기에서 숫자가 어긋나면 둘 중 하나가 잘못 읽었을 가능성이 크다.
// 여기서는 DB 없이 숫자를 비교해 "의심 문항"과 그 이유를 만든다(화면: /admin/digitize-check, 문제 글 고치기).
//
// 점수: 3 = 강한 의심(서로 다른 숫자가 짝으로 보임, 정답 선택지 값이 다름), 2 = AI가 흐리다고 표시, 1 = 한쪽에만 있는 숫자.
// 2점 이상을 목록에 올린다. 원장님이 "문제없음"을 누르면 그때의 글 지문(okHash)을 남겨, 글이 바뀌기 전까지는 다시 안 띄운다.

import { textOf, type ItemText } from "./itemEdit";
import { latexToPlain } from "@/lib/grading";

const plain = (x: string) => latexToPlain(x).replace(/\$/g, "").trim() || x;

export type SuspectReason = { kind: "swap" | "choice" | "unsure" | "onlyDigitized" | "onlySummary"; score: number; text: string };
export type SuspectResult = { score: number; reasons: SuspectReason[] };

const SUP: Record<string, string> = { "⁰": "^0", "¹": "^1", "²": "^2", "³": "^3", "⁴": "^4", "⁵": "^5", "⁶": "^6", "⁷": "^7", "⁸": "^8", "⁹": "^9" };
const CIRC = "①②③④⑤⑥⑦⑧";

/** 글 속 숫자 모음(여러 번 나오면 여러 개). LaTeX 명령 이름·원문자·배점 표기는 뺀다. */
export function numbersOf(s: unknown): string[] {
  // 원문자·위첨자는 NFKC 전에(NFKC가 ③을 3으로 바꿔 버림)
  let t = String(s ?? "")
    .replace(/[①②③④⑤⑥⑦⑧]/g, " ")
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => SUP[c] ?? c)
    .normalize("NFKC")
    .replace(/\[\s*\d+(\.\d+)?\s*점\s*\]|\(\s*\d+(\.\d+)?\s*점\s*\)/g, " ") // [4점]
    .replace(/\\[a-zA-Z]+/g, " ") // \frac, \sqrt …
    .replace(/(\d),(\d{3})(?!\d)/g, "$1$2"); // 1,000 → 1000
  // "0.5"는 하나로, 나머지는 자리마다
  const out = t.match(/\d+(?:\.\d+)?/g) ?? [];
  return out.map((x) => x.replace(/^0+(?=\d)/, ""));
}

function bag(xs: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}
/** a에는 있고 b에는 없는 것(개수까지) */
function minus(a: Map<string, number>, b: Map<string, number>): string[] {
  const out: string[] = [];
  for (const [k, n] of a) for (let i = b.get(k) ?? 0; i < n; i++) out.push(k);
  return out;
}

/** 디지털화 문항 글 전체(문제·상자·선택지) */
export function digitizedText(t: ItemText): string {
  return [t.stem, t.box_title, ...t.box_lines, ...t.choices].join("\n");
}

/** 정답 표시("④ 12", "④ $\\frac{1}{2}$")에서 고른 번호와 그 값. 값이 없으면 null */
export function answerChoiceValue(display: unknown): { n: number; value: string } | null {
  const s = String(display ?? "").trim();
  const m = /^([①②③④⑤])\s*[:.)]?\s*(.+)$/.exec(s);
  if (!m) return null;
  const value = m[2].trim();
  if (!value || /^[①②③④⑤,\s]+$/.test(value)) return null;
  return { n: CIRC.indexOf(m[1]) + 1, value };
}

const TRIVIAL = new Set(["0", "1", "2"]);

/**
 * 한 문항을 살핀다. summary: 처음 자동 처리 때의 문제 요약들(소문항이면 여러 개), solution: 그 풀이들,
 * mcAnswerDisplay: 객관식이면 정답 표시(하나일 때만), unsure: 디지털화 때 AI가 남긴 "흐림" 메모.
 */
export function inspectItem(opts: { item: any; summary: string[]; solution: string[]; mcAnswerDisplay?: string | null }): SuspectResult {
  const t = textOf(opts.item);
  const reasons: SuspectReason[] = [];
  const summary = opts.summary.filter(Boolean).join("\n");
  // 선택지 숫자는 요약·풀이에 잘 안 나와서(①~⑤ 값) 비교에서 빼고, 정답 선택지만 따로 본다(아래)
  const D = bag(numbersOf([t.stem, t.box_title, ...t.box_lines].join("\n")));
  const S = bag(numbersOf(summary));
  const SOL = bag(numbersOf(opts.solution.filter(Boolean).join("\n")));
  const SS = new Map(S);
  for (const [k, n] of SOL) SS.set(k, Math.max(SS.get(k) ?? 0, n));

  if (summary.replace(/\s/g, "").length >= 20 && D.size) {
    // 요약에 있는데 디지털화 글에 없는 숫자 / 디지털화 글에만 있고 요약·풀이 어디에도 없는 숫자
    const onlyS = Array.from(new Set(minus(S, D))).filter((x) => !TRIVIAL.has(x) || S.get(x)! > 1);
    const onlyD = Array.from(new Set(minus(D, SS))).filter((x) => !(SS.get(x) ?? 0) && (!TRIVIAL.has(x) || x.length > 1));
    if (onlyS.length && onlyD.length) {
      reasons.push({
        kind: "swap",
        score: 3,
        text: `옮겨 적은 글의 ${onlyD.slice(0, 4).join(", ")} ↔ 처음 읽은 문제 요약의 ${onlyS.slice(0, 4).join(", ")}`,
      });
    } else if (onlyD.length) {
      reasons.push({ kind: "onlyDigitized", score: 1, text: `옮겨 적은 글에만 있는 숫자 ${onlyD.slice(0, 5).join(", ")}` });
    } else if (onlyS.length >= 2 || onlyS.some((x) => x.length > 1)) {
      reasons.push({ kind: "onlySummary", score: 1, text: `문제 요약에만 있는 숫자 ${onlyS.slice(0, 5).join(", ")}(옮겨 적을 때 빠졌을 수 있음)` });
    }
  }

  // 객관식: 정답 표시의 값(④ 12)과 옮겨 적은 선택지 ④의 숫자가 다르면
  const av = answerChoiceValue(opts.mcAnswerDisplay);
  if (av && t.choices[av.n - 1] !== undefined) {
    const a = numbersOf(av.value).sort().join(",");
    const c = numbersOf(t.choices[av.n - 1]).sort().join(",");
    if (a && c !== a) {
      reasons.push({ kind: "choice", score: 3, text: `정답 ${CIRC[av.n - 1]}의 값이 풀이에서는 ${plain(av.value)}인데 옮겨 적은 선택지는 ${plain(t.choices[av.n - 1]) || "(빈칸)"}` });
    }
  }

  if (t.unsure.trim()) reasons.push({ kind: "unsure", score: 2, text: `AI가 흐리다고 남김: ${t.unsure.trim().slice(0, 80)}` });

  const score = reasons.reduce((s, r) => s + r.score, 0);
  return { score, reasons };
}

/** 글 지문 — "문제없음"을 누른 뒤 글이 바뀌었는지 알아보는 데 쓴다 */
export function textHash(it: any): string {
  const s = JSON.stringify(textOf(it));
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export const SUSPECT_MIN = 2;
