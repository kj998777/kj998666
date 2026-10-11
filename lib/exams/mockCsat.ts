// 고3 사설 모의고사(수능형) — 2026-10-11 원장님: "고3 사설모의고사도 입력·제출할 수 있게. 디지털화·해설 작성 없이
// 문제지·해설지를 내가 둘 다 올리게". 선택: 한 시험에서 학생이 선택과목을 고름 / 해설지는 원장님·선생님 화면과 과외 스토어 /
// 정답은 해설지에서 AI가 읽기.
//
// 정답표(answer_key) 모양: 공통 1~22는 번호 그대로("1"…"22"), 선택과목 23~30은 과목 머리말을 붙인다("확통23", "미적23",
// "기하23" …). 그래서 선택과목은 정답표 번호만 보고 알 수 있고(choiceOfLabel), 학생 채점 결과(per_item)에도 고른 과목
// 번호만 남는다 — 재채점·보고서는 per_item에 있는 번호로 그 학생의 과목을 알아낸다. DB·네트워크를 쓰지 않는 순수 계산
// (test/mockCsat.test.ts).

export const CHOICES = [
  { key: "확통", name: "확률과 통계" },
  { key: "미적", name: "미적분" },
  { key: "기하", name: "기하" },
] as const;
export type ChoiceKey = (typeof CHOICES)[number]["key"];

const CHOICE_RE = /^(확통|미적|기하)(\d+)$/;

export function isChoiceKey(v: unknown): v is ChoiceKey {
  return v === "확통" || v === "미적" || v === "기하";
}

/** 정답표 번호 → 선택과목(공통 문항이면 null) */
export function choiceOfLabel(label: string): ChoiceKey | null {
  const m = CHOICE_RE.exec(String(label ?? "").trim());
  return m ? (m[1] as ChoiceKey) : null;
}

export function choiceName(key: string | null | undefined): string {
  return CHOICES.find((c) => c.key === key)?.name ?? "";
}

/** 화면에 보일 번호: "미적23" → "23" (공통은 그대로) */
export function displayNo(label: string): string {
  const m = CHOICE_RE.exec(String(label ?? "").trim());
  return m ? m[2] : String(label ?? "");
}

/** 정답표에 선택과목 문항이 있는가(= 수능형 모의고사로 다룰 시험) */
export function hasChoices(labels: string[]): boolean {
  return labels.some((l) => choiceOfLabel(l) !== null);
}

/** 수능 수학 배점·문항 형식(2022 개정 수능, 총 100점: 공통 74 + 선택 26) */
export function csatSpec(no: number, part: "공통" | ChoiceKey): { points: number; type: "객관식" | "주관식" } {
  if (part === "공통") {
    const points = no <= 2 ? 2 : no <= 8 ? 3 : no <= 15 ? 4 : no <= 19 ? 3 : 4;
    return { points, type: no <= 15 ? "객관식" : "주관식" };
  }
  const points = no === 23 ? 2 : no <= 27 ? 3 : 4;
  return { points, type: no <= 28 ? "객관식" : "주관식" };
}

export const COMMON_NOS = Array.from({ length: 22 }, (_, i) => i + 1);
export const CHOICE_NOS = Array.from({ length: 8 }, (_, i) => i + 23);

/** 정답 입력 모양: part("공통"|과목) → 번호 → 정답 글자 */
export type CsatAnswers = Record<"공통" | ChoiceKey, Record<number, string>>;

export function emptyAnswers(): CsatAnswers {
  return { 공통: {}, 확통: {}, 미적: {}, 기하: {} };
}

export type KeyRow = { item_label: string; correct_answers: string; points: number; type: "객관식" | "주관식"; sort_order: number };

/** 객관식 답은 1~5 한 글자(①~⑤도 받음), 단답형은 공백을 뺀 값. 빈 값이면 "". */
export function cleanAnswer(type: "객관식" | "주관식", v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (type === "객관식") {
    const circ: Record<string, string> = { "①": "1", "②": "2", "③": "3", "④": "4", "⑤": "5" };
    const c = circ[s] ?? s.replace(/[^1-5]/g, "").slice(0, 1);
    return /^[1-5]$/.test(c) ? c : "";
  }
  return s.replace(/\s+/g, "").slice(0, 40);
}

/**
 * 입력 → 정답표 줄. 공통 22문항은 모두 있어야 하고, 선택과목은 23~30 여덟 문항이 다 찬 과목만 넣는다(일부만 찬 과목은
 * missing으로 알려 준다). 순서: 공통 1~22 → 확통 → 미적 → 기하.
 */
export function buildKeyRows(a: CsatAnswers): { rows: KeyRow[]; missing: string[]; subjects: ChoiceKey[] } {
  const rows: KeyRow[] = [];
  const missing: string[] = [];
  for (const no of COMMON_NOS) {
    const spec = csatSpec(no, "공통");
    const v = cleanAnswer(spec.type, a.공통?.[no]);
    if (!v) missing.push(`공통 ${no}번`);
    rows.push({ item_label: String(no), correct_answers: v, points: spec.points, type: spec.type, sort_order: rows.length });
  }
  const subjects: ChoiceKey[] = [];
  for (const c of CHOICES) {
    const vals = CHOICE_NOS.map((no) => cleanAnswer(csatSpec(no, c.key).type, a[c.key]?.[no]));
    const filled = vals.filter(Boolean).length;
    if (filled === 0) continue;
    if (filled < CHOICE_NOS.length) {
      CHOICE_NOS.forEach((no, i) => !vals[i] && missing.push(`${c.name} ${no}번`));
      continue;
    }
    subjects.push(c.key);
    CHOICE_NOS.forEach((no, i) => {
      const spec = csatSpec(no, c.key);
      rows.push({ item_label: `${c.key}${no}`, correct_answers: vals[i], points: spec.points, type: spec.type, sort_order: rows.length });
    });
  }
  return { rows, missing, subjects };
}

/** 정답표 줄 → 입력 모양(다시 고칠 때) */
export function answersFromKeys(keys: { item_label: string; correct_answers: string }[]): CsatAnswers {
  const out = emptyAnswers();
  for (const k of keys) {
    const c = choiceOfLabel(k.item_label);
    const no = Number(displayNo(k.item_label));
    if (!Number.isFinite(no)) continue;
    out[c ?? "공통"][no] = String(k.correct_answers ?? "");
  }
  return out;
}

/** 공통 + 고른 과목 문항만(학생 제출 채점·제출 화면) */
export function keysForChoice<T extends { item_label: string }>(keys: T[], choice: ChoiceKey | null): T[] {
  return keys.filter((k) => {
    const c = choiceOfLabel(k.item_label);
    return c === null || c === choice;
  });
}

/** 채점 결과(per_item)에 남은 번호로 그 학생의 선택과목 */
export function choiceFromLabels(labels: string[]): ChoiceKey | null {
  for (const l of labels) {
    const c = choiceOfLabel(l);
    if (c) return c;
  }
  return null;
}

/** 그 학생이 푼 문항만(공통 + per_item에 있는 과목). 선택과목이 없는 시험이면 그대로. */
export function keysForStudent<T extends { item_label?: string; label?: string }>(keys: T[], perItemLabels: string[]): T[] {
  const lab = (k: T) => String(k.item_label ?? k.label ?? "");
  if (!keys.some((k) => choiceOfLabel(lab(k)))) return keys;
  const choice = choiceFromLabels(perItemLabels);
  return keys.filter((k) => {
    const c = choiceOfLabel(lab(k));
    return c === null || c === choice;
  });
}

/** 만점: 공통 합 + 선택과목 묶음 중 가장 큰 합(보통 26점). 선택과목이 없으면 전체 합. */
export function examMaxPoints(keys: { item_label: string; points: number | string | null }[]): number {
  let common = 0;
  const by = new Map<string, number>();
  for (const k of keys) {
    const p = Number(k.points) || 0;
    const c = choiceOfLabel(k.item_label);
    if (c) by.set(c, (by.get(c) ?? 0) + p);
    else common += p;
  }
  const best = by.size ? Math.max(...Array.from(by.values())) : 0;
  return Math.round((common + best) * 100) / 100;
}

/** 수능형 시험 보고서용 문항 정보: 영역 = 공통/과목, 난이도 = 배점 기준(2점 하 · 3점 중 · 4점 상) */
export function mockItemMeta(label: string, points: number): { area: string; difficulty: "하" | "중" | "상" } {
  const c = choiceOfLabel(label);
  return {
    area: c ? choiceName(c) : "공통(수학Ⅰ·수학Ⅱ)",
    difficulty: points <= 2 ? "하" : points >= 4 ? "상" : "중",
  };
}

/** 보고서 데이터에서 한 학생 몫만(공통 + 그 학생 과목 문항) — 선택과목이 없는 시험이면 그대로 */
export function reportForStudent<D extends { items: { label: string }[] }>(d: D, perItemLabels: string[]): D {
  if (!hasChoices(d.items.map((i) => i.label))) return d;
  return { ...d, items: keysForStudent(d.items, perItemLabels) };
}

/** 종합 보고서용: 선택과목별로 나눈 묶음(그 과목 학생 + 공통·그 과목 문항). 선택과목이 없으면 [전체] 하나. */
export function reportGroups<D extends { items: { label: string }[]; students: { per_item: { item_label: string }[] }[] }>(
  d: D
): { choice: ChoiceKey | null; name: string; data: D }[] {
  if (!hasChoices(d.items.map((i) => i.label))) return [{ choice: null, name: "", data: d }];
  const out: { choice: ChoiceKey | null; name: string; data: D }[] = [];
  for (const c of CHOICES) {
    const students = d.students.filter((s) => choiceFromLabels(s.per_item.map((p) => String(p.item_label))) === c.key);
    if (!students.length) continue;
    const items = d.items.filter((i) => {
      const k = choiceOfLabel(i.label);
      return k === null || k === c.key;
    });
    out.push({ choice: c.key, name: c.name, data: { ...d, students, items } });
  }
  return out;
}

/** 시험별 만점·문항 수(학생 한 명 기준 — 선택과목은 한 과목만) — 학생 분석·내 학생 화면의 득점률 계산용 */
export function examTotalsByExam(keys: { exam_id: string; item_label: string; points: number | string | null }[]): Map<string, { max: number; n: number }> {
  const by = new Map<string, { item_label: string; points: number | string | null }[]>();
  for (const k of keys) {
    const l = by.get(k.exam_id) ?? [];
    l.push(k);
    by.set(k.exam_id, l);
  }
  const out = new Map<string, { max: number; n: number }>();
  by.forEach((list, examId) => {
    const choice = choiceFromLabels(list.map((k) => k.item_label));
    out.set(examId, { max: examMaxPoints(list), n: keysForChoice(list, choice).length });
  });
  return out;
}
