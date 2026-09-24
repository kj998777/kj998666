// AI 결과 정리용 순수 함수들. Apps Script의 autoLabel_/autoBaseKey_/autoBaseCount_/autoNormQs_/
// autoStrList_/autoTotalOf_/mcDigitOf_/shortAnswerOf_/needRecheck_/cleanText_/fixSafe_/plainFix_
// 를 그대로 포팅. DB에 의존하지 않는 순수 로직이라 lib/grading.test.ts 처럼 단위 테스트하기 쉽다.

import { normalizeAnswer, isCorrect } from "@/lib/grading";
import type { QuestionMeta } from "./prompts";

const SA_WORD: Record<string, string> = {
  서답형: "서답형",
  서답: "서답형",
  서술형: "서술형",
  서술: "서술형",
  논술형: "논술형",
  논술: "논술형",
  단답형: "단답형",
  단답: "단답형",
  주관식: "주관식",
  주관: "주관식",
  서: "서술형",
};

/** AI가 적은 문항 번호를 정리: 공백·대괄호·끝의 "번"/"." 을 빼고, "서2"·"서술 3" 같은 표기는 서술형2·서술형3 으로 통일 */
export function autoLabel(raw: unknown): string {
  let s = String(raw ?? "")
    .replace(/\s+/g, "")
    .replace(/^[\[【]+/, "")
    .replace(/[\]】]+$/, "");
  const m = /^(서답형|서술형|논술형|단답형|주관식|서답|서술|논술|단답|주관|서)[.\-:]?(\d{1,2})(?!\d)(.*)$/.exec(s);
  if (m) s = SA_WORD[m[1]] + m[2] + m[3];
  return s.replace(/번$/, "").replace(/[.．:：]$/, "");
}

/** 27-(1) → 27, 서답형1-(2) → 서답형1 */
export function autoBaseKey(label: string): string {
  return label.replace(/-\(.*$/, "");
}

/** 소문항을 묶은 큰 문항 개수 */
export function autoBaseCount(qs: { label: string }[]): number {
  const seen = new Set<string>();
  for (const q of qs) seen.add(autoBaseKey(q.label));
  return seen.size;
}

export type NormInfo = { renamed: string[]; dropped: string[] };

/**
 * AI가 낸 문항 목록을 정리. info 를 주면 info.renamed(서답형 번호가 객관식 번호와 겹쳐 이름을
 * 바꾼 것)·info.dropped(같은 번호가 또 나와 뺀 것)를 채운다. 서답형이 1번부터 다시 매겨진
 * 시험에서 label 이 객관식과 겹쳐 서답형이 통째로 사라지던 문제를 막는다.
 */
export function autoNormQs(input: any, info: NormInfo): QuestionMeta[] {
  const out: QuestionMeta[] = [];
  const questions = Array.isArray(input?.questions) ? input.questions : [];
  for (const q of questions) {
    if (!q) continue;
    const label = autoLabel(q.label);
    if (!label) continue;
    let p: number | null = q.points == null || q.points === "" ? null : Number(q.points);
    if (p !== null && (isNaN(p) || p <= 0 || p > 100)) p = null;
    let pa = q.printed_answer == null ? "" : String(q.printed_answer).trim().slice(0, 60);
    if (/^(null|없음|-)$/i.test(pa)) pa = "";
    out.push({
      label,
      type: q.type === "mc" ? "mc" : "short",
      points: p,
      page: Number(q.page) || 0,
      area: String(q.area || "").slice(0, 40),
      unit: String(q.unit || "").slice(0, 60),
      stem: String(q.stem_start || "").slice(0, 50),
      fig: q.has_figure === true,
      pa,
    });
  }
  const mcBase = new Set<string>();
  for (const q of out) if (q.type === "mc") mcBase.add(autoBaseKey(q.label));
  const renamed: string[] = [];
  for (const q of out) {
    const b = autoBaseKey(q.label);
    if (q.type !== "mc" && /^\d+$/.test(b) && mcBase.has(b)) {
      const nl = "서답형" + q.label;
      renamed.push(q.label + "→" + nl);
      q.label = nl;
    }
  }
  const seen = new Set<string>();
  const dropped: string[] = [];
  const res: QuestionMeta[] = [];
  for (const q of out) {
    if (seen.has(q.label)) {
      dropped.push(q.label);
      continue;
    }
    seen.add(q.label);
    res.push(q);
  }
  info.renamed = renamed;
  info.dropped = dropped;
  return res.slice(0, 60);
}

export function autoStrList(a: unknown, maxN: number, maxLen: number): string[] {
  const out: string[] = [];
  if (Array.isArray(a)) {
    for (const raw of a) {
      const s = String(raw ?? "").trim();
      if (s && out.length < maxN) out.push(s.slice(0, maxLen));
    }
  }
  return out;
}

export function autoTotalOf(input: any): number {
  const n = Math.round(Number(input?.total_count));
  return n > 0 && n < 200 ? n : 0;
}

/** 본문 정리: 수식($…$) 밖의 < > & 는 HTML 로 안전하게(<b> <i> <br> 만 허용), 수식 안의 < > 는 \lt \gt 로 */
export function cleanText(input: unknown): string {
  const s = String(input ?? "");
  const parts = s.split("$");
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1 && i < parts.length - 1) {
      parts[i] = parts[i].replace(/</g, "\\lt ").replace(/>/g, "\\gt ");
    } else {
      parts[i] = parts[i]
        .split(/(<\/?(?:b|i|br)\s*\/?>)/i)
        .map((seg, k) => {
          if (k % 2 === 1) return seg;
          return seg.replace(/&(?!(?:amp|lt|gt);)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        })
        .join("");
    }
  }
  return parts.join("$");
}

export function mcDigitOf(s: unknown): string {
  const m = /^[1-5]/.exec(normalizeAnswer(String(s ?? "")).replace(/^\$+/, ""));
  return m ? m[0] : "";
}

export function shortAnswerOf(s: unknown): string {
  return String(s ?? "")
    .replace(/\$/g, "")
    .replace(/[\s　]+$/, "")
    .replace(/^[\s　]+/, "")
    .slice(0, 100);
}

/** 첫 풀이의 답이 의심스러운가: 확신 low · 답 없음 · 시험지에 인쇄된 정답과 다름 */
export function needRecheck(q: QuestionMeta, s: any): boolean {
  if (!s) return false;
  const ai = q.type === "mc" ? mcDigitOf(s.answer) : shortAnswerOf(s.answer);
  const pa = q.pa ? (q.type === "mc" ? mcDigitOf(q.pa) : shortAnswerOf(q.pa)) : "";
  if (!ai || s.confidence === "low") return true;
  return !!(pa && !isCorrect(ai, pa));
}

/** 정정 문구용 평문: HTML·수식 표시를 걷어냄 */
export function plainFix(s: unknown, max = 300): string {
  let t = String(s ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/\$/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  t = t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return t.slice(0, max);
}

/** 정오표(학생이 보고 문제를 푸는 자료)에 실으면 안 되는 표현: 정답·풀이·계산 결과를 알려 주는 말 */
const FIX_ANS = /정답|해답|모범\s*답|답안|정해|답\s*[은는이가을를도만:：=]|답으로|풀이|해설|풀면|풀어\s*보면|계산하면|구하면|구한\s*값|따라서|그러므로|∴|결과는|결과가|결론|(?:옳은|맞는|알맞은|정확한)\s*(?:것|선지|선택지|보기)|answer/i;

/** 정오표용 문구: 평문으로 바꾸고, 답과 관련된 괄호·절·문장을 뺌(무조건). 남는 것이 없으면 '' */
export function fixSafe(v: unknown, max = 300): string {
  const t = plainFix(v, 2000);
  if (!t) return "";
  const lines: string[] = [];
  for (let line of t.split("\n")) {
    line = line.replace(/[(（\[［][^)）\]］\n]*[)）\]］]/g, (m) => (FIX_ANS.test(m) ? "" : m));
    const sents = line.match(/(?:[^.。!?！？;；]|\.(?=\d))+[.。!?！？;；]?/g) || [];
    const keep: string[] = [];
    for (let x of sents) {
      x = x.replace(/^\s+|\s+$/g, "");
      if (!x) continue;
      if (!FIX_ANS.test(x)) {
        keep.push(x);
        continue;
      }
      const end = /[.。!?！？;；]$/.test(x) ? x.charAt(x.length - 1) : "";
      const cl = x
        .replace(/[.。!?！？;；]$/, "")
        .split(/[,，]/)
        .filter((c) => c.replace(/\s/g, "") !== "" && !FIX_ANS.test(c));
      const r = cl.join(",").replace(/^\s+|\s+$/g, "");
      if (r.replace(/[\s\d.,]/g, "").length >= 3) keep.push(r + end);
    }
    if (keep.length) lines.push(keep.join(" "));
  }
  return lines.join("\n").replace(/[ \t]{2,}/g, " ").trim().slice(0, max);
}
