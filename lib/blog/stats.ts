// 블로그 글에 쓰는 공개 집계(2026-10-01). 학원 블로그 자동 작성(Claude 예약 작업)이 /api/blog/stats 로 읽는다.
//
// ⚠️ 이 결과는 누구나 볼 수 있는 공개 주소로 나간다. 그래서 여기에는 "블로그에 그대로 실어도 되는 숫자"만 넣는다.
//   - 학교 이름·시험 이름·시험 코드·학생 이름·반 이름·개별 점수는 절대 넣지 않는다.
//   - 학생 정답률은 제출이 충분히 쌓였을 때(MIN_SUBMISSIONS 이상)만, 그리고 묶음마다 답이 MIN_ANSWERS 이상일 때만 낸다.
// 계산은 순수 함수로 두고(test/blogStats.test.ts), 읽기는 route.ts가 서비스롤로 한다.

export const DIFFS = ["하", "중하", "중", "중상", "상"] as const;
export type Diff = (typeof DIFFS)[number];
const BASIC: Diff[] = ["하", "중하", "중"];
const HARD: Diff[] = ["중상", "상"];

export const MIN_SUBMISSIONS = 30;
export const MIN_ANSWERS = 50;

export type ExamRow = {
  id: string;
  school_level: string | null;
  folder_grade: number | null;
  folder_year: string | null;
  is_jeju: boolean | null;
  created_at: string | null;
};
export type KeyRow = { exam_id: string; item_label: string; type: string | null; points: number | null };
export type ExplRow = { exam_id: string; item_label: string; area: string | null; unit: string | null; difficulty: string | null };
export type GradingRow = { exam_id: string; per_item: { item_label: string; correct: boolean }[] | null };

type Item = {
  examId: string;
  label: string;
  level: "고" | "중" | "기타";
  grade: number | null;
  area: string;
  unit: string;
  diff: Diff;
  type: "객관식" | "서답형" | "";
  points: number;
};

const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
const pct = (a: number, b: number) => (b > 0 ? r1((a / b) * 100) : 0);
const clean = (s: string | null | undefined) => String(s ?? "").normalize("NFC").replace(/\s+/g, " ").trim();

function diffDist(items: Item[]) {
  const n = items.length;
  const out: Record<string, { count: number; pct: number }> = {};
  for (const d of DIFFS) {
    const c = items.filter((i) => i.diff === d).length;
    out[d] = { count: c, pct: pct(c, n) };
  }
  return out;
}

function hardShare(items: Item[]) {
  return pct(items.filter((i) => HARD.includes(i.diff)).length, items.length);
}

function groupTop(items: Item[], key: (i: Item) => string, limit: number) {
  const m = new Map<string, Item[]>();
  for (const it of items) {
    const k = key(it);
    if (!k) continue;
    const arr = m.get(k) ?? [];
    arr.push(it);
    m.set(k, arr);
  }
  return Array.from(m.entries())
    .map(([name, arr]) => ({
      name,
      count: arr.length,
      exams: new Set(arr.map((a) => a.examId)).size,
      hardPct: hardShare(arr),
      basicPct: pct(arr.filter((a) => BASIC.includes(a.diff)).length, arr.length),
      topPct: pct(arr.filter((a) => a.diff === "상").length, arr.length),
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function kstMonth(iso: string | null) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 7);
}

export function computeBlogStats(
  exams: ExamRow[],
  keys: KeyRow[],
  expls: ExplRow[],
  gradings: GradingRow[],
  now: Date = new Date()
) {
  const examById = new Map(exams.map((e) => [e.id, e]));
  const explByKey = new Map(expls.map((x) => [`${x.exam_id}|${x.item_label}`, x]));

  // 문항 = 정답표 줄 중 영역·난이도가 정리된 것
  const items: Item[] = [];
  for (const k of keys) {
    const e = examById.get(k.exam_id);
    const x = explByKey.get(`${k.exam_id}|${k.item_label}`);
    if (!e || !x) continue;
    const diff = (DIFFS as readonly string[]).includes(String(x.difficulty)) ? (x.difficulty as Diff) : null;
    if (!diff) continue;
    items.push({
      examId: e.id,
      label: k.item_label,
      level: e.school_level === "고" ? "고" : e.school_level === "중" ? "중" : "기타",
      grade: e.folder_grade ?? null,
      area: clean(x.area),
      unit: clean(x.unit),
      diff,
      type: k.type === "객관식" ? "객관식" : k.type === "주관식" ? "서답형" : "",
      points: Number(k.points ?? 0) || 0,
    });
  }

  const examIds = Array.from(new Set(items.map((i) => i.examId)));
  const usedExams = examIds.map((id) => examById.get(id)!);
  const byExam = new Map<string, Item[]>();
  for (const it of items) {
    const arr = byExam.get(it.examId) ?? [];
    arr.push(it);
    byExam.set(it.examId, arr);
  }

  // ── 배점: 배점이 정리된 시험만, 시험마다 100점으로 환산
  const scored = examIds.map((id) => byExam.get(id)!).filter((arr) => arr.reduce((s, i) => s + i.points, 0) > 0);
  const per100 = (arr: Item[], ds: Diff[]) => {
    const tot = arr.reduce((s, i) => s + i.points, 0);
    return (arr.filter((i) => ds.includes(i.diff)).reduce((s, i) => s + i.points, 0) / tot) * 100;
  };
  const stat = (xs: number[]) =>
    xs.length ? { mean: r1(xs.reduce((a, b) => a + b, 0) / xs.length), min: r1(Math.min(...xs)), max: r1(Math.max(...xs)) } : null;
  const scoredItems = scored.flat();
  const totalPts = scoredItems.reduce((s, i) => s + i.points, 0);
  const pointsByDiff: Record<string, { sharePct: number; perExamPer100: number | null; avgPerItem: number }> = {};
  for (const d of DIFFS) {
    const its = scoredItems.filter((i) => i.diff === d);
    pointsByDiff[d] = {
      sharePct: pct(its.reduce((s, i) => s + i.points, 0), totalPts),
      perExamPer100: stat(scored.map((arr) => per100(arr, [d])))?.mean ?? null,
      avgPerItem: its.length ? r2(its.reduce((s, i) => s + i.points, 0) / its.length) : 0,
    };
  }

  // ── 학교급 비교
  const levelBlock = (lv: "고" | "중") => {
    const its = items.filter((i) => i.level === lv);
    return {
      exams: new Set(its.map((i) => i.examId)).size,
      items: its.length,
      difficulty: diffDist(its),
      hardPct: hardShare(its),
      basicLowPct: pct(its.filter((i) => i.diff === "하" || i.diff === "중하").length, its.length),
    };
  };

  // ── 학년별(학교급+학년)
  const gradeGroups = groupTop(
    items.filter((i) => i.level !== "기타" && i.grade),
    (i) => `${i.level}${i.grade}`,
    10
  );

  // ── 문항 유형(객관식/서답형)
  const typeBlock = (t: "객관식" | "서답형") => {
    const its = items.filter((i) => i.type === t);
    const sItems = scoredItems.filter((i) => i.type === t);
    return {
      items: its.length,
      perExam: examIds.length ? r1(its.length / examIds.length) : 0,
      pointsSharePct: pct(sItems.reduce((s, i) => s + i.points, 0), totalPts),
      hardPct: hardShare(its),
      difficulty: diffDist(its),
    };
  };

  // ── 최근 추가
  const nowMs = now.getTime();
  const within = (days: number) => usedExams.filter((e) => e.created_at && nowMs - new Date(e.created_at).getTime() <= days * 86400_000);
  const recent = (days: number) => {
    const ex = within(days);
    const ids = new Set(ex.map((e) => e.id));
    return { exams: ex.length, items: items.filter((i) => ids.has(i.examId)).length, jejuExams: ex.filter((e) => e.is_jeju).length };
  };
  const monthly = new Map<string, number>();
  for (const e of usedExams) {
    const m = kstMonth(e.created_at);
    if (m) monthly.set(m, (monthly.get(m) ?? 0) + 1);
  }

  // ── 학생 정답률(충분히 쌓였을 때만)
  const itemByKey = new Map(items.map((i) => [`${i.examId}|${i.label}`, i]));
  const answers: { it: Item; ok: boolean }[] = [];
  let subs = 0;
  for (const g of gradings) {
    if (!Array.isArray(g.per_item)) continue;
    let any = false;
    for (const p of g.per_item) {
      const it = itemByKey.get(`${g.exam_id}|${p?.item_label}`);
      if (!it) continue;
      answers.push({ it, ok: !!p.correct });
      any = true;
    }
    if (any) subs++;
  }
  const acc = (arr: { ok: boolean }[]) => (arr.length >= MIN_ANSWERS ? pct(arr.filter((a) => a.ok).length, arr.length) : null);
  let studentAccuracy: any = { available: false, submissions: subs, needed: MIN_SUBMISSIONS };
  if (subs >= MIN_SUBMISSIONS) {
    const byDiff: Record<string, number | null> = {};
    for (const d of DIFFS) byDiff[d] = acc(answers.filter((a) => a.it.diff === d));
    const areaMap = new Map<string, { ok: boolean }[]>();
    for (const a of answers) {
      if (!a.it.area) continue;
      const arr = areaMap.get(a.it.area) ?? [];
      arr.push(a);
      areaMap.set(a.it.area, arr);
    }
    studentAccuracy = {
      available: true,
      submissions: subs,
      answers: answers.length,
      overallPct: acc(answers),
      byDifficulty: byDiff,
      byType: { 객관식: acc(answers.filter((a) => a.it.type === "객관식")), 서답형: acc(answers.filter((a) => a.it.type === "서답형")) },
      byArea: Array.from(areaMap.entries())
        .filter(([, arr]) => arr.length >= MIN_ANSWERS)
        .map(([name, arr]) => ({ name, answers: arr.length, accuracyPct: acc(arr) }))
        .sort((a, b) => (a.accuracyPct ?? 0) - (b.accuracyPct ?? 0)),
    };
  }

  return {
    generatedAt: now.toISOString(),
    note: "난이도(하·중하·중·중상·상)는 메딕수학이 문항을 직접 풀어 보고 매긴 값(학생 정답률 아님). 검토 중인 시험도 포함. 학교·시험 이름과 학생 개인 정보는 포함하지 않음.",
    totals: {
      exams: examIds.length,
      items: items.length,
      highExams: usedExams.filter((e) => e.school_level === "고").length,
      midExams: usedExams.filter((e) => e.school_level === "중").length,
      jejuExams: usedExams.filter((e) => e.is_jeju).length,
      scoredExams: scored.length,
      avgItemsPerExam: examIds.length ? r1(items.length / examIds.length) : 0,
      areas: new Set(items.map((i) => i.area).filter(Boolean)).size,
      units: new Set(items.map((i) => i.unit).filter(Boolean)).size,
    },
    difficulty: diffDist(items),
    points: {
      byDifficulty: pointsByDiff,
      basicPer100: stat(scored.map((arr) => per100(arr, BASIC))),
      lowPer100: stat(scored.map((arr) => per100(arr, ["하", "중하"]))),
      topPer100: stat(scored.map((arr) => per100(arr, ["상"]))),
      hardPer100: stat(scored.map((arr) => per100(arr, HARD))),
    },
    schoolLevel: { 고: levelBlock("고"), 중: levelBlock("중") },
    grades: gradeGroups,
    types: { 객관식: typeBlock("객관식"), 서답형: typeBlock("서답형") },
    areas: groupTop(items, (i) => i.area, 25),
    units: groupTop(items, (i) => i.unit, 40),
    areasByLevel: { 고: groupTop(items.filter((i) => i.level === "고"), (i) => i.area, 15), 중: groupTop(items.filter((i) => i.level === "중"), (i) => i.area, 15) },
    recent: { last7d: recent(7), last30d: recent(30), byMonth: Array.from(monthly.entries()).sort().slice(-12).map(([month, exams]) => ({ month, exams })) },
    studentAccuracy,
  };
}
