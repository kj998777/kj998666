// 풀이 결과 조합. Apps Script의 autoCombine_ 를 그대로 포팅.
// 문항(추출 단계 결과) + 풀이(AI submit_solution 결과, 필요하면 다시 푼 결과까지) → 시트/테이블에
// 쓸 최종 한 줄로 합친다.

import { isCorrect } from "@/lib/grading";
import type { Difficulty } from "@/lib/supabase/types";
import { cleanText, mcDigitOf, plainFix, shortAnswerOf, studentFixes } from "./normalize";
import type { QuestionMeta } from "./prompts";

export type AiSolution = {
  answer?: string;
  answer_display?: string;
  unit?: string;
  difficulty?: string;
  difficulty_reason?: string;
  statement?: string;
  solution?: string;
  confidence?: "high" | "medium" | "low";
  notes?: string[];
  exam_fix?: { issue?: string; fix?: string; teacher_note?: string };
};

export type CombinedFlag = {
  c?: "high" | "medium" | "low" | "fail";
  rs?: 1;
  a1?: string;
  ai?: string;
  pa?: string;
  use?: "re" | "pa";
  /** 2026-10-05(0050): 시험지에 인쇄된 정답이 있고 AI 답이 그것과 같다 — 이때만 "AI 확신"으로 바로 확정한다 */
  pm?: boolean;
};

export type CombinedRow = {
  label: string;
  type: "mc" | "short";
  points: number | null;
  page: number;
  bbox: QuestionMeta["bbox"];
  assigned: boolean;
  flag: CombinedFlag;
  area: string;
  answer: string;
  unit: string;
  diff: Difficulty;
  why: string;
  stmt: string;
  disp: string;
  sol: string;
  notes: string[];
  fix?: { issue: string; fix: string };
};

const DIFF_SET: Difficulty[] = ["하", "중하", "중", "중상", "상"];
const CIRC: Record<string, string> = { "1": "①", "2": "②", "3": "③", "4": "④", "5": "⑤" };

function pick(type: "mc" | "short", v: unknown): string {
  return type === "mc" ? mcDigitOf(v) : shortAnswerOf(v);
}
function same(x: string, y: string): boolean {
  return !!x && !!y && isCorrect(x, y);
}
function confOf(t: AiSolution | undefined): "high" | "medium" | "low" {
  const c = t?.confidence;
  return c === "high" || c === "medium" || c === "low" ? c : "medium";
}
// AI 도구 호출은 notes 를 문자열 배열로 돌려주기로 스키마에 정해 두었지만, 실제로는(특히 노트가
// 하나뿐일 때) 배열 대신 문자열 하나만 돌려주는 경우가 실제로 관찰됐다(예: notes: "…") — 이때
// `(s.notes || []).filter(...)` 는 문자열이 truthy라 그대로 문자열에 .filter를 호출해
// "t.notes.filter is not a function" 오류로 죽고, 재시도해도 같은 문항에서 매번 같은 값을
// 돌려받으니 재시도 6회를 다 채우고 시험 전체가 영구 오류로 멈췄다. 배열이 아니면 문자열로,
// 그것도 아니면 빈 배열로 안전하게 정리한다.
function notesArr(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && !!x);
  if (typeof v === "string" && v.trim()) return [v];
  return [];
}

export function autoCombine(
  q: QuestionMeta,
  s: AiSolution | null,
  areas: string[],
  s2: AiSolution | null
): CombinedRow {
  const row: CombinedRow = {
    label: q.label,
    type: q.type,
    points: q.points,
    page: q.page,
    bbox: q.bbox,
    assigned: false,
    flag: {},
    area: "",
    answer: "",
    unit: "",
    diff: "중",
    why: "",
    stmt: "",
    disp: "",
    sol: "",
    notes: [],
  };
  let area = q.area;
  if (areas.length && !areas.includes(area)) area = areas[0];
  row.area = area || "";

  if (!s) {
    row.answer = q.pa ? pick(q.type, q.pa) : "";
    row.unit = q.unit;
    row.diff = "중";
    row.why = "";
    row.stmt = q.stem ? cleanText(q.stem + " …") : "";
    row.disp = row.answer;
    row.sol = "자동 풀이에 실패했습니다. 이 문항은 직접 확인해 주세요.";
    row.flag = { c: "fail" };
    row.notes = [q.label + "번: 자동 풀이에 실패했습니다. 정답을 직접 확인해 입력하세요."];
    return row;
  }

  const ai = pick(q.type, s.answer);
  const pa = q.pa ? pick(q.type, q.pa) : "";
  const ai2 = s2 ? pick(q.type, s2.answer) : "";
  let sx: AiSolution = s;

  if (s2 && ai2) {
    // 다시 푼 결과가 있는 문항: 시험지에 인쇄된 정답이 있으면 그대로 정답(예전과 같음), 없으면
    // 다시 푼 답을 정답으로 삼는다. 어느 쪽이든 다시 푼 답이 정답과 다르거나 확신이 낮으면 검토 요청.
    const p2 = same(ai2, pa);
    const p1 = same(ai, pa);
    const a12 = same(ai2, ai);
    let use: "re" | "pa";
    if (!pa) {
      row.answer = ai2;
      use = "re";
      sx = s2;
    } else {
      row.answer = pa;
      use = "pa";
      sx = p2 || !p1 ? s2 : s; // 풀이 글은 정답과 같은 답을 낸 풀이를 씀
    }
    const agree = pa ? p2 : a12;
    const c2 = confOf(s2);
    row.flag = { c: agree && c2 !== "low" ? c2 : "low", rs: 1, a1: ai, ai: ai2, use };
    if (pa) row.flag.pa = pa;
    if (pa && p2) row.flag.pm = true;
    row.notes = notesArr(sx.notes).slice(0, 5).map((t) => q.label + "번: " + t);
    if (!agree || c2 === "low") {
      row.notes.push(
        q.label +
          "번: 처음 풀이의 정답이 불확실해 다시 풀었습니다(처음 " +
          (ai || "없음") +
          " · 다시 " +
          ai2 +
          (pa ? " · 시험지 인쇄 " + pa : "") +
          "). " +
          (use === "re"
            ? "다시 푼 답 " + row.answer + " 을(를) 정답으로 설정했습니다"
            : "정답은 시험지 인쇄 정답 " + row.answer + " 을(를) 그대로 뒀습니다") +
          " — 풀이가 맞는지 확인하세요."
      );
    }
  } else {
    row.answer = pa || ai;
    row.notes = notesArr(s.notes).slice(0, 5).map((t) => q.label + "번: " + t);
    row.flag = { c: confOf(s) };
    if (pa && ai && isCorrect(ai, pa)) row.flag.pm = true;
    if (pa && ai && !isCorrect(ai, pa)) {
      row.flag.c = "low";
      row.flag.pa = pa;
      row.flag.ai = ai;
      row.notes.push(
        q.label + "번: 시험지에 인쇄된 정답(" + pa + ")과 AI가 푼 값(" + ai + ")이 다릅니다. 정답은 시험지 표기를 따랐으니 풀이가 맞는지 확인하세요."
      );
    }
    if (!ai) {
      row.flag.c = "low";
      row.notes.push(q.label + "번: AI가 정답을 제시하지 않았습니다.");
    }
  }
  if (!row.answer) row.flag.c = "fail";

  row.unit = String(sx.unit || q.unit || "").slice(0, 60);
  row.diff = DIFF_SET.includes(String(sx.difficulty || "").trim() as Difficulty)
    ? (String(sx.difficulty).trim() as Difficulty)
    : "중";
  row.why = cleanText(String(sx.difficulty_reason || "").slice(0, 300));
  row.stmt = cleanText(String(sx.statement || "").slice(0, 1500));
  row.disp = cleanText(String(sx.answer_display || row.answer).slice(0, 300));
  const axi = pick(q.type, sx.answer);
  if (row.answer && axi && !same(axi, row.answer)) {
    // 정답 표시가 최종 정답과 어긋나지 않게
    row.disp = cleanText(q.type === "mc" ? CIRC[mcDigitOf(row.answer)] || row.answer : row.answer);
  }
  row.sol = cleanText(String(sx.solution || "").slice(0, 6000));

  const ef = sx.exam_fix || s.exam_fix || s2?.exam_fix;
  if (ef && typeof ef === "object") {
    // 학생용 정오표: 답 관련 표현을 빼고, "오류 없음"류는 정정으로 치지 않는다(studentFixes)
    const safe = studentFixes([{ issue: String(ef.issue ?? ""), fix: String(ef.fix ?? "") }])[0];
    const iss = safe?.issue ?? "";
    const fx = safe?.fix ?? "";
    if (iss || fx) row.fix = { issue: iss, fix: fx };
    const nows = (x: string) => x.replace(/\s+/g, "");
    if (nows(plainFix(ef.issue, 300)) !== nows(iss) || nows(plainFix(ef.fix, 500)) !== nows(fx)) {
      row.notes.push(q.label + "번: 정정 문구에 답·풀이와 관련된 표현이 있어 정오표에서는 그 부분을 자동으로 뺐습니다.");
    }
    const tn = plainFix(ef.teacher_note, 300);
    if (tn) row.notes.push(q.label + "번 정정 참고(학생에게 안 보임): " + tn);
  }

  return row;
}
