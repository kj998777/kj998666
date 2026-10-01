// 입학테스트(2026-10-01 원장님 요청: "입학테스트 문제 10문제 정도 만드는 기능").
// 문항 은행(검토 끝난 기출)에서 학년·과목 범위를 고르면 쉬운 문항부터 어려운 문항까지 고르게, 단원이 겹치지 않게 골라 준다.
// 화면(서버)·테스트가 같이 쓰는 순수 계산만 둔다(test/placement.test.ts).
import { DIFFS, type BankItem } from "@/lib/bank/search";
import { buildTree, classify, inUnitScope, scopeText, type TreeGrade } from "@/lib/curriculum/units";

export const PLACEMENT_DEFAULT_N = 10;
export const PLACEMENT_MIN_N = 5;
export const PLACEMENT_MAX_N = 20;
/** 과외선생님이 입학테스트 1개를 만들 때 드는 포인트(DB 함수 tutor_create_placement와 같은 값, 0047) */
export const TUTOR_PLACEMENT_COST = 2;

// 2026-10-01 원장님: 범위를 "학교급 → 학년 → 과목 → 단원(대단원 안에 중단원)" 체크로 고른다(lib/curriculum/units.ts).
// course = 단원표 과목 키(""면 그 학년 전 과목), units = 고른 중단원 id(null이면 그 범위 전부).
export type Scope = { level: "중" | "고"; grade: number; course: string; units: string[] | null };

// 시험 이름에서 과목 이름을 읽는다(없으면 ""). 공통수학 → 수학Ⅱ → 수학Ⅰ 순서로 봐야 "수학 II"가 "수학 I"로 읽히지 않는다.
const SUBJECTS: [RegExp, string][] = [
  [/공통\s*수학\s*(2|Ⅱ|II)/i, "공통수학2"],
  [/공통\s*수학\s*(1|Ⅰ|I)/i, "공통수학1"],
  [/수학\s*\(?\s*상\s*\)?/, "수학(상)"],
  [/수학\s*\(?\s*하\s*\)?/, "수학(하)"],
  [/수학\s*(II|Ⅱ|2)(?![0-9])/i, "수학Ⅱ"],
  [/수학\s*(I|Ⅰ|1)(?![0-9I])/i, "수학Ⅰ"],
  [/미적분/, "미적분"],
  [/확률\s*과\s*통계|확통/, "확률과 통계"],
  [/기하/, "기하"],
  [/대수/, "대수"],
];

export function subjectOf(examName: string): string {
  // 앞쪽 연도·학기("2025년 2학기")의 숫자를 과목 숫자로 잘못 읽지 않게, "학기" 뒤부터 본다
  const s = String(examName ?? "").normalize("NFC").replace(/_/g, " ");
  const tail = s.replace(/^.*?학기/, "");
  for (const [re, name] of SUBJECTS) if (re.test(tail)) return name;
  return "";
}

export function scopeLabel(s: Scope): string {
  return scopeText(s);
}

/** 입학테스트에 쓸 수 있는 문항: 정답 확정 + 정답 있음 + 객관식/주관식 */
export function usable(it: BankItem): boolean {
  return it.confirmed && !!it.correctAnswers.trim() && (it.type === "객관식" || it.type === "주관식");
}

export function scopePool(items: BankItem[], s: Scope): BankItem[] {
  return items.filter(
    (it) =>
      usable(it) &&
      it.schoolLevel === s.level &&
      Number(it.grade) === s.grade &&
      inUnitScope(it, { course: s.course || undefined, units: s.units })
  );
}

/** 고를 수 있는 범위 나무(문항이 있는 학년 → 과목 → 대단원 → 중단원, 개수 포함) */
export function scopeTree(items: BankItem[]): TreeGrade[] {
  return buildTree(items.filter(usable));
}

/** 난이도별 목표 문항 수 — 하 20% · 중하 20% · 중 30% · 중상 20% · 상 10%(10문항이면 2·2·3·2·1) */
export function targetCounts(n: number): Record<string, number> {
  const share = [0.2, 0.2, 0.3, 0.2, 0.1];
  const raw = share.map((p) => p * n);
  const base = raw.map(Math.floor);
  let left = n - base.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (const o of order) {
    if (left <= 0) break;
    base[o.i]++;
    left--;
  }
  const out: Record<string, number> = {};
  DIFFS.forEach((d, i) => (out[d] = base[i]));
  return out;
}

/** 같은 seed면 같은 결과(다시 뽑기는 seed만 바꾼다) */
export function rng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dIdx = (d: string) => {
  const i = DIFFS.indexOf(d);
  return i < 0 ? 2 : i;
};
const unitKey = (it: BankItem) => String(it.unit || it.area || "").replace(/\s+/g, "");
// 2026-10-01: 단원이 겹치지 않게 — 단원표 중단원(lib/curriculum/units.ts)이 같은지 먼저, 그다음 적힌 단원 글이 같은지
const midKey = (it: BankItem) => classify(it)?.id ?? `?${unitKey(it)}`;

/** 이미 고른 문항과 단원·시험이 겹치지 않을수록, 원래 자리를 찾을 수 있을수록 먼저 */
function bestOf(cands: BankItem[], chosen: BankItem[], r: () => number): BankItem | null {
  if (!cands.length) return null;
  const units = new Map<string, number>();
  const mids = new Map<string, number>();
  const exams = new Map<string, number>();
  for (const c of chosen) {
    units.set(unitKey(c), (units.get(unitKey(c)) ?? 0) + 1);
    mids.set(midKey(c), (mids.get(midKey(c)) ?? 0) + 1);
    exams.set(c.examId, (exams.get(c.examId) ?? 0) + 1);
  }
  let best: BankItem | null = null;
  let bestScore = Infinity;
  for (const it of cands) {
    const s = (mids.get(midKey(it)) ?? 0) * 10 + (units.get(unitKey(it)) ?? 0) * 6 + (exams.get(it.examId) ?? 0) * 3 + (it.hasLocation ? 0 : 2) + r();
    if (s < bestScore) {
      bestScore = s;
      best = it;
    }
  }
  return best;
}

/** 쉬운 문항 → 어려운 문항 순서(같은 난이도는 단원 이름 순) */
export function orderForTest(items: BankItem[]): BankItem[] {
  return [...items].sort((a, b) => dIdx(a.difficulty) - dIdx(b.difficulty) || unitKey(a).localeCompare(unitKey(b), "ko"));
}

export function pickPlacement(pool: BankItem[], n: number, seed: number): BankItem[] {
  const want = Math.max(PLACEMENT_MIN_N, Math.min(PLACEMENT_MAX_N, Math.round(n) || PLACEMENT_DEFAULT_N));
  const r = rng(seed);
  const target = targetCounts(want);
  const chosen: BankItem[] = [];
  const used = new Set<string>();
  const left = (d: string) => pool.filter((it) => !used.has(it.id) && it.difficulty === d);
  // 난이도마다 목표만큼 — 모자라면 가까운 난이도에서 빌려 온다(중 → 중하·중상 → 하·상 순)
  for (const d of DIFFS) {
    for (let k = 0; k < target[d]; k++) {
      const di = dIdx(d);
      const near = [...DIFFS].sort((a, b) => Math.abs(dIdx(a) - di) - Math.abs(dIdx(b) - di) || dIdx(a) - dIdx(b));
      let got: BankItem | null = null;
      for (const nd of near) {
        got = bestOf(left(nd), chosen, r);
        if (got) break;
      }
      if (!got) break;
      chosen.push(got);
      used.add(got.id);
    }
  }
  return orderForTest(chosen);
}

/** 한 문항만 바꾸기: 같은 난이도(없으면 가까운 난이도)에서, 지금 고른 문항·이미 뺀 문항은 빼고 */
export function replaceItem(pool: BankItem[], current: BankItem[], index: number, seed: number, exclude: Set<string> = new Set()): BankItem | null {
  const old = current[index];
  if (!old) return null;
  const r = rng(seed);
  const taken = new Set(current.map((x) => x.id));
  const others = current.filter((_, i) => i !== index);
  const di = dIdx(old.difficulty);
  const near = [...DIFFS].sort((a, b) => Math.abs(dIdx(a) - di) - Math.abs(dIdx(b) - di) || dIdx(a) - dIdx(b));
  for (const d of near) {
    const got = bestOf(
      pool.filter((it) => it.difficulty === d && !taken.has(it.id) && !exclude.has(it.id)),
      others,
      r
    );
    if (got) return got;
  }
  return null;
}

/** 배점: 합이 100점이 되게 — 나누어떨어지지 않으면 뒤쪽(어려운) 문항에 1점씩 더 */
export function pointsFor(n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(100 / n);
  const extra = 100 - base * n;
  return Array.from({ length: n }, (_, i) => base + (i >= n - extra ? 1 : 0));
}

// ---------------------------------------------------------------------
// 진단(보고서·결과 화면)
// ---------------------------------------------------------------------

export type DiagItem = { label: string; unit: string; area: string; difficulty: string; points: number; correct: boolean; guessed?: boolean };

export type Diagnosis = {
  score: number;
  realScore: number;
  byDiff: { d: string; n: number; ok: number }[];
  byUnit: { unit: string; n: number; ok: number }[];
  weakUnits: string[];
  level: "기초" | "표준" | "심화";
  levelNote: string;
};

export const LEVEL_NOTE: Record<Diagnosis["level"], string> = {
  기초: "개념·공식을 바로 적용하는 문항부터 다시 다지는 수업이 맞습니다.",
  표준: "기본기는 갖춰져 있습니다. 교과서·기출 표준 문항으로 실수를 줄이며 어려운 문항으로 넓혀 가면 됩니다.",
  심화: "어려운 문항까지 스스로 풀어냅니다. 심화·최상위 문항 위주의 수업이 맞습니다.",
};

export function diagnose(items: DiagItem[]): Diagnosis {
  let score = 0;
  let guessedPts = 0;
  const byD = new Map<string, { n: number; ok: number }>();
  const byU = new Map<string, { unit: string; n: number; ok: number }>();
  for (const it of items) {
    if (it.correct) score += it.points;
    if (it.correct && it.guessed) guessedPts += it.points;
    const real = it.correct && !it.guessed;
    const d = byD.get(it.difficulty) ?? { n: 0, ok: 0 };
    d.n++;
    if (real) d.ok++;
    byD.set(it.difficulty, d);
    const name = (it.unit || it.area || "기타").trim();
    const k = name.replace(/\s+/g, "");
    const u = byU.get(k) ?? { unit: name, n: 0, ok: 0 };
    u.n++;
    if (real) u.ok++;
    byU.set(k, u);
  }
  score = Math.round(score * 100) / 100;
  const realScore = Math.round((score - guessedPts) * 100) / 100;
  const byDiff = DIFFS.filter((d) => byD.has(d)).map((d) => ({ d, ...byD.get(d)! }));
  const byUnit = Array.from(byU.values()).sort((a, b) => a.ok / a.n - b.ok / b.n || b.n - a.n || a.unit.localeCompare(b.unit, "ko"));
  const weakUnits = byUnit.filter((u) => u.ok < u.n).map((u) => u.unit);
  const hard = items.filter((it) => it.difficulty === "중상" || it.difficulty === "상");
  const hardOk = hard.filter((it) => it.correct && !it.guessed).length;
  const level: Diagnosis["level"] = realScore >= 80 && (hard.length === 0 || hardOk / hard.length >= 0.5) ? "심화" : realScore >= 50 ? "표준" : "기초";
  return { score, realScore, byDiff, byUnit, weakUnits, level, levelNote: LEVEL_NOTE[level] };
}
