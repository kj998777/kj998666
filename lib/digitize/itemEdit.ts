// 디지털화된 문항 한 개 고치기(2026-09-30 원장님 요청) — 숫자·글자를 잘못 옮겨 적은 문항을
//  ① 관리자가 직접 고치거나, ② 그 문항"만" AI에게 다시 읽혀 덮어쓴다.
// 여기는 DB·브라우저 없이 시험할 수 있는 부분: 입력 다듬기, 합치기(그림 자리는 그대로 둠), 처음 AI 글 보관, 바뀐 칸 찾기.
//
// 저장 모양(digitized_pages.data.items[i]):
//   - 원래 필드(label/points/stem/box_title/box_lines/choices/unsure)를 새 값으로 바꾼다. figures(그림 자리)는 건드리지 않는다.
//   - orig: 처음 고칠 때의 AI 원래 글(한 번만 남김) — "AI가 처음 읽은 글로 되돌리기"에 쓴다.
//   - edited: "manual"(직접) | "ai"(AI로 다시 읽음), edited_at: 고친 시각.

export type ItemText = {
  label: string;
  points: number | null;
  stem: string;
  box_title: string;
  box_lines: string[];
  choices: string[];
  unsure: string;
};

export const TEXT_KEYS: (keyof ItemText)[] = ["label", "points", "stem", "box_title", "box_lines", "choices", "unsure"];

export const LIMITS = { label: 20, stem: 6000, box_title: 100, box_line: 600, box_lines: 20, choice: 600, choices: 8, unsure: 500 };

const str = (v: unknown, max: number) =>
  String(v ?? "")
    .replace(/\r\n?/g, "\n")
    .slice(0, max);

/** 화면·AI가 준 값을 저장해도 되는 모양으로(길이 제한·빈 줄 정리). 실패하면 이유를 돌려준다. */
export function cleanItemText(input: any): { ok: true; text: ItemText } | { ok: false; msg: string } {
  if (!input || typeof input !== "object") return { ok: false, msg: "고친 내용이 비어 있습니다." };
  const label = str(input.label, LIMITS.label).trim();
  const stem = str(input.stem, LIMITS.stem + 1);
  if (stem.length > LIMITS.stem) return { ok: false, msg: `문제 글이 너무 깁니다(${LIMITS.stem}자까지).` };
  if (!stem.trim()) return { ok: false, msg: "문제 글이 비어 있습니다." };
  let points: number | null = null;
  if (input.points !== null && input.points !== undefined && String(input.points).trim() !== "") {
    const n = Number(String(input.points).trim());
    if (!Number.isFinite(n) || n < 0 || n > 100) return { ok: false, msg: "배점은 0~100 사이 숫자로 적어 주세요(없으면 비워 두기)." };
    points = Math.round(n * 100) / 100;
  }
  const lines = (v: unknown, each: number, most: number): string[] | null => {
    const arr = Array.isArray(v) ? v : typeof v === "string" ? v.split("\n") : [];
    const out = arr.map((x) => str(x, each).trim()).filter((x) => x !== "");
    return out.length > most ? null : out;
  };
  const box_lines = lines(input.box_lines, LIMITS.box_line, LIMITS.box_lines);
  if (!box_lines) return { ok: false, msg: `<보기> 줄은 ${LIMITS.box_lines}줄까지입니다.` };
  // 선택지는 빈 칸을 지우면 번호가 밀리므로, 뒤쪽 빈 칸만 뺀다
  const rawChoices = Array.isArray(input.choices) ? input.choices : typeof input.choices === "string" ? input.choices.split("\n") : [];
  const choices = rawChoices.map((x: unknown) => str(x, LIMITS.choice).trim());
  while (choices.length && !choices[choices.length - 1]) choices.pop();
  if (choices.length > LIMITS.choices) return { ok: false, msg: `선택지는 ${LIMITS.choices}개까지입니다.` };
  return {
    ok: true,
    text: {
      label,
      points,
      stem: stem.replace(/\n{3,}/g, "\n\n").trim(),
      box_title: str(input.box_title, LIMITS.box_title).trim(),
      box_lines,
      choices,
      unsure: str(input.unsure, LIMITS.unsure).trim(),
    },
  };
}

/** 저장된 문항에서 글 부분만 꺼낸다(없는 칸은 빈 값). */
export function textOf(it: any): ItemText {
  return {
    label: String(it?.label ?? ""),
    points: typeof it?.points === "number" && Number.isFinite(it.points) ? it.points : null,
    stem: String(it?.stem ?? ""),
    box_title: String(it?.box_title ?? ""),
    box_lines: Array.isArray(it?.box_lines) ? it.box_lines.map((x: unknown) => String(x ?? "")) : [],
    choices: Array.isArray(it?.choices) ? it.choices.map((x: unknown) => String(x ?? "")) : [],
    unsure: String(it?.unsure ?? ""),
  };
}

/** 문항에 새 글을 덮어쓴다. 그림 자리(figures)와 그 밖의 칸은 그대로, 처음 고칠 때만 AI 원래 글을 orig에 남긴다. */
export function mergeItemText(it: any, text: ItemText, source: "manual" | "ai" | "revert", now: string): any {
  const base = it && typeof it === "object" ? it : {};
  const out: any = { ...base, ...text };
  if (source === "revert") {
    delete out.orig;
    delete out.edited;
    delete out.edited_at;
    return out;
  }
  if (!base.orig) out.orig = textOf(base);
  out.edited = source;
  out.edited_at = now;
  return out;
}

export type FieldChange = { key: keyof ItemText; before: string; after: string };

const show = (v: unknown): string => (Array.isArray(v) ? v.join("\n") : v == null ? "" : String(v));

/** 두 글에서 바뀐 칸들(화면에 "AI가 이렇게 바꿨어요"로 보여 줌) */
export function changedFields(a: ItemText, b: ItemText): FieldChange[] {
  const out: FieldChange[] = [];
  for (const k of TEXT_KEYS) {
    const x = show(a[k]);
    const y = show(b[k]);
    if (x !== y) out.push({ key: k, before: x, after: y });
  }
  return out;
}

/** 글 속 숫자만 뽑아 비교 — "숫자를 잘못 읽은" 곳을 눈에 띄게(바뀐 숫자 목록) */
export function changedNumbers(before: string, after: string): { removed: string[]; added: string[] } {
  const nums = (s: string) => (s.match(/\d+(?:\.\d+)?/g) ?? []) as string[];
  const count = (arr: string[]) => arr.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>());
  const a = count(nums(before));
  const b = count(nums(after));
  const removed: string[] = [];
  const added: string[] = [];
  for (const [k, n] of a) for (let i = (b.get(k) ?? 0); i < n; i++) removed.push(k);
  for (const [k, n] of b) for (let i = (a.get(k) ?? 0); i < n; i++) added.push(k);
  return { removed, added };
}

export const FIELD_LABEL: Record<keyof ItemText, string> = {
  label: "문항 번호",
  points: "배점",
  stem: "문제 글",
  box_title: "상자 제목",
  box_lines: "<보기>·조건 줄",
  choices: "선택지",
  unsure: "불확실한 부분",
};
