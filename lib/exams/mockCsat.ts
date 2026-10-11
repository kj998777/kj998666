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

// ---------------------------------------------------------------------
// 해설지 쪽 지도(0054 exams.solution_page_map) — 2026-10-11 원장님 "보고서 만들 때 올린 해설에서 틀린 문제 해설을 찾아서 첨부".
// AI가 해설지를 몇 쪽씩 나눠 보고 "이 쪽에 풀이가 있는 문항"을 읽기 순서대로 알려 주면(app/(staff)/exams/[code]/solution-pages),
// 여기서 문항 번호 → 쪽 목록으로 모은다. 선택과목 머리말(확률과 통계·미적분·기하)은 과목이 시작하는 쪽에만 있어서, AI가 과목을
// 모르는 쪽은 순서로 메운다: 23~30번이 다시 작아지면(예: 30 → 23) 다음 과목, 과목 이름이 보이면 그 과목.

export type PageMap = Record<string, number[]>;
/** 해설지 쪽 찾기 한 번에 AI에게 보내는 쪽 수(60초 안에 끝나게) */
export const SOLUTION_PAGE_BATCH = 6;
export type PageEntry = { no: number; part: "공통" | ChoiceKey | null };

const CHOICE_ORDER: ChoiceKey[] = ["확통", "미적", "기하"];

/** 쪽별 문항 목록(쪽 순서 상관없음) → 문항별 쪽 목록 */
export function buildPageMap(pages: { page: number; items: PageEntry[] }[]): PageMap {
  const out: PageMap = {};
  const add = (label: string, page: number) => {
    const l = (out[label] ??= []);
    if (!l.includes(page)) l.push(page);
  };
  const sorted = [...pages].filter((p) => Number.isInteger(p.page) && p.page > 0).sort((a, b) => a.page - b.page);
  let cur: ChoiceKey | null = null;
  let lastNo = 0;
  const used = new Set<ChoiceKey>();
  const nextUnused = (): ChoiceKey => CHOICE_ORDER.find((c) => !used.has(c)) ?? cur ?? "기하";
  for (const p of sorted) {
    for (const e of p.items ?? []) {
      const no = Number(e?.no);
      if (!Number.isInteger(no) || no < 1 || no > 30) continue;
      if (no <= 22) {
        add(String(no), p.page);
        continue;
      }
      const given = isChoiceKey(e.part) ? e.part : null;
      if (given) cur = given;
      else if (!cur || no < lastNo) cur = nextUnused();
      used.add(cur);
      lastNo = no;
      add(`${cur}${no}`, p.page);
    }
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => a - b);
  return out;
}

/** DB에서 읽은 값 다듬기(모양이 틀린 칸은 버림) */
export function cleanPageMap(v: unknown): PageMap {
  const out: PageMap = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [k, arr] of Object.entries(v as Record<string, unknown>)) {
    const label = String(k).trim();
    if (!/^(\d{1,2}|(확통|미적|기하)\d{2})$/.test(label) || !Array.isArray(arr)) continue;
    const pages = Array.from(new Set(arr.map(Number).filter((n) => Number.isInteger(n) && n > 0 && n < 1000))).sort((a, b) => a - b);
    if (pages.length) out[label] = pages.slice(0, 10);
  }
  return out;
}

/** 틀린 문항들의 해설 쪽(중복 없이 오름차순) */
export function pagesForLabels(map: PageMap, labels: string[]): number[] {
  const s = new Set<number>();
  for (const l of labels) for (const p of map[l] ?? []) s.add(p);
  return Array.from(s).sort((a, b) => a - b);
}

function labelOrder(label: string): number {
  const c = choiceOfLabel(label);
  const no = Number(displayNo(label)) || 0;
  return c ? 100 * (CHOICE_ORDER.indexOf(c) + 1) + no : no;
}

function pagesText(pages: number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    parts.push(j > i ? `${pages[i]}-${pages[j]}` : String(pages[i]));
    i = j;
  }
  return parts.join(",");
}

/** 화면에서 고칠 수 있게 글로: 한 줄에 "번호: 쪽" (예: "미적23: 25-26") */
export function pageMapToText(map: PageMap): string {
  return Object.keys(map)
    .sort((a, b) => labelOrder(a) - labelOrder(b))
    .map((l) => `${l}: ${pagesText(map[l])}`)
    .join("\n");
}

/** pageMapToText의 반대. 틀린 줄은 errors로 알려 준다. */
export function parsePageMapText(text: string): { map: PageMap; errors: string[] } {
  const raw: Record<string, number[]> = {};
  const errors: string[] = [];
  for (const line0 of String(text ?? "").split(/\r?\n/)) {
    const line = line0.trim();
    if (!line) continue;
    const m = /^((?:확통|미적|기하)?\s*\d{1,2})\s*[:：]\s*([\d,\s~-]+)$/.exec(line);
    if (!m) {
      errors.push(line);
      continue;
    }
    const label = m[1].replace(/\s+/g, "");
    const pages: number[] = [];
    for (const part of m[2].split(",")) {
      const r = /^\s*(\d+)\s*(?:[-~]\s*(\d+))?\s*$/.exec(part);
      if (!r) continue;
      const a = Number(r[1]);
      const b = r[2] ? Number(r[2]) : a;
      for (let p = Math.min(a, b); p <= Math.max(a, b) && p - Math.min(a, b) < 10; p++) pages.push(p);
    }
    if (!pages.length) errors.push(line);
    else raw[label] = pages;
  }
  return { map: cleanPageMap(raw), errors };
}

// ---------------------------------------------------------------------
// 예상 등급컷(0055 exams.grade_cuts) — 2026-10-11 원장님 "예상 등급컷이 나와 있는 경우 해당 등급컷도 성적 산출에 반영".
// 해설지에 실린 전국 예상 등급컷(원점수)을 선택과목별로 1컷부터 적어 두면, 보고서가 학생 점수로 예상 등급을 낸다.

export type GradeCuts = Partial<Record<ChoiceKey, number[]>>;
export const GRADE_CUT_SLOTS = 4; // 화면에서 적는 칸 수(1~4등급컷)

/** DB·입력 값 다듬기: 과목별로 0~100 숫자만, 앞에서부터 빈칸 없이, 내려가는 순서가 아니면 거기서 자름 */
export function cleanGradeCuts(v: unknown): GradeCuts {
  const out: GradeCuts = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const c of CHOICES) {
    const arr = (v as Record<string, unknown>)[c.key];
    if (!Array.isArray(arr)) continue;
    const cuts: number[] = [];
    for (const x of arr.slice(0, 8)) {
      if (x === null || x === "" || x === undefined) break;
      const n = Number(x);
      if (!Number.isFinite(n) || n <= 0 || n > 100) break;
      if (cuts.length && n >= cuts[cuts.length - 1]) break;
      cuts.push(Math.round(n * 100) / 100);
    }
    if (cuts.length) out[c.key] = cuts;
  }
  return out;
}

export function hasGradeCuts(cuts: GradeCuts | null | undefined): boolean {
  return !!cuts && Object.values(cuts).some((a) => Array.isArray(a) && a.length > 0);
}

/** 점수 → 예상 등급. 컷이 3개(1~3등급)면 3컷 아래는 "4등급 이하". 컷이 없으면 null. */
export function expectedGrade(score: number, cuts: number[] | null | undefined): { grade: number; label: string } | null {
  if (!cuts || !cuts.length || !Number.isFinite(Number(score))) return null;
  for (let i = 0; i < cuts.length; i++) if (Number(score) >= cuts[i]) return { grade: i + 1, label: `${i + 1}등급` };
  return { grade: cuts.length + 1, label: `${cuts.length + 1}등급 이하` };
}

/** "1컷 82 · 2컷 72 · 3컷 64" */
export function gradeCutsText(cuts: number[] | null | undefined): string {
  return (cuts ?? []).map((c, i) => `${i + 1}컷 ${c}`).join(" · ");
}
