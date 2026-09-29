// 학생별 누적 성적·단원 약점 분석 (2026-09-30 원장님 요청)
//
// 학생 제출(submissions)에는 학생 표가 없고 반 이름 + 이름만 있다. 그래서
//   - 학원 반 제출은 "반 이름 + 이름"(예: 고1 2반 김철수),
//   - 과외 반 제출(submissions.tutor_id 있음)은 "선생님 + 이름"
// 을 한 학생으로 자동으로 묶는다(autoKey). 작년 반·이름 오타처럼 같은 학생인데 키가 다르면 직원이 "합치기"로
// 묶는다(student_keys.merged_into, 0039). 이 파일은 DB를 모르는 순수 계산만 한다 — 화면(서버)과 누적 보고서
// PDF(브라우저)가 함께 쓰고, test/studentAnalysis.test.ts로 검증한다.

export type PerItem = { item_label: string; given: string; correct: boolean; points: number };

export type SubRow = {
  id: string;
  exam_id: string;
  class_label: string;
  student_name: string;
  tutor_id: string | null;
  submitted_at: string;
  total_score: number;
  per_item?: PerItem[];
};

export type ExamMeta = {
  id: string;
  code: string;
  name: string;
  /** 정답표 배점 합(0이면 문항 수로 비율을 낸다) */
  max: number;
  /** 정답표 문항 수 */
  n: number;
};

export type Difficulty = "하" | "중하" | "중" | "중상" | "상";
export const DIFFS: Difficulty[] = ["하", "중하", "중", "중상", "상"];

export type ItemMeta = {
  exam_id: string;
  label: string;
  sort_order: number;
  points: number;
  type: "객관식" | "주관식";
  area: string;
  unit: string;
  difficulty: Difficulty;
  correct_answers?: string;
  problem_statement?: string;
  answer_display?: string;
  solution?: string;
};

export type KeyRow = { key: string; merged_into: string | null; hidden: boolean; memo: string };

// ---------------------------------------------------------------------
// 학생 키
// ---------------------------------------------------------------------

export function normName(s: string): string {
  return String(s ?? "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

/** 자동 학생 키. 과외 반 제출은 선생님별로 따로(서로 다른 선생님의 같은 이름 학생이 섞이지 않게). */
export function autoKey(s: Pick<SubRow, "class_label" | "student_name" | "tutor_id">): string {
  const name = normName(s.student_name);
  if (s.tutor_id) return `과외:${s.tutor_id}|${name}`;
  return `반:${normName(s.class_label)}|${name}`;
}

export function keyName(key: string): string {
  const i = key.indexOf("|");
  return i >= 0 ? key.slice(i + 1) : key;
}

/** 주소에 넣을 수 있게(이름이 한글이라) base64url로 */
export function encodeKey(key: string): string {
  const bytes = new TextEncoder().encode(key);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin); // 브라우저·Node 18+ 모두 전역 btoa/atob가 있다
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeKey(s: string): string | null {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const out = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return /^(반|과외):.+\|.+/.test(out) ? out : null;
  } catch {
    return null;
  }
}

/** 합치기 사슬을 따라 대표 키를 찾는다(고리가 있어도 멈춤). */
export function makeResolver(rows: KeyRow[]): (key: string) => string {
  const next = new Map<string, string>();
  for (const r of rows) if (r.merged_into) next.set(r.key, r.merged_into);
  return (key: string) => {
    let k = key;
    const seen = new Set<string>([k]);
    while (next.has(k)) {
      const n = next.get(k)!;
      if (seen.has(n)) break;
      seen.add(n);
      k = n;
    }
    return k;
  };
}

// ---------------------------------------------------------------------
// 공통 계산
// ---------------------------------------------------------------------

export function rateOf(score: number, exam: ExamMeta | undefined, perItem?: PerItem[]): number | null {
  if (!exam) return null;
  if (exam.max > 0) return Math.max(0, Math.min(1, score / exam.max));
  if (perItem && perItem.length) return perItem.filter((p) => p.correct).length / perItem.length;
  return null;
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** 같은 학생이 같은 시험을 두 번 냈으면(반을 옮겨 다시 낸 경우 등) 마지막 것만 */
function latestPerExam(subs: SubRow[]): SubRow[] {
  const by = new Map<string, SubRow>();
  for (const s of subs) {
    const p = by.get(s.exam_id);
    if (!p || p.submitted_at < s.submitted_at) by.set(s.exam_id, s);
  }
  return Array.from(by.values()).sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));
}

// ---------------------------------------------------------------------
// 학생 목록
// ---------------------------------------------------------------------

export type StudentListEntry = {
  key: string;
  name: string;
  /** 제출에 쓰인 반 이름(과외는 "과외") — 최근 것부터 */
  classLabels: string[];
  tutorId: string | null;
  members: string[];
  nExams: number;
  firstAt: string;
  lastAt: string;
  avgRate: number | null;
  lastRate: number | null;
  /** 시간순 득점률(추이 미니 그래프용) */
  rates: number[];
  hidden: boolean;
  hasMemo: boolean;
};

export function groupStudents(subs: SubRow[], exams: Map<string, ExamMeta>, keyRows: KeyRow[]): StudentListEntry[] {
  const resolve = makeResolver(keyRows);
  const meta = new Map(keyRows.map((r) => [r.key, r]));
  const groups = new Map<string, { subs: SubRow[]; members: Set<string> }>();
  for (const s of subs) {
    const k = autoKey(s);
    const root = resolve(k);
    const g = groups.get(root) ?? { subs: [], members: new Set<string>() };
    g.subs.push(s);
    g.members.add(k);
    groups.set(root, g);
  }
  const out: StudentListEntry[] = [];
  for (const [key, g] of groups) {
    const list = latestPerExam(g.subs);
    const rates = list.map((s) => rateOf(s.total_score, exams.get(s.exam_id), s.per_item)).filter((r): r is number => r != null);
    const byRecent = [...g.subs].sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
    const classLabels = Array.from(new Set(byRecent.map((s) => normName(s.class_label))));
    const newest = byRecent[0];
    out.push({
      key,
      name: normName(newest.student_name) || keyName(key),
      classLabels,
      tutorId: newest.tutor_id ?? null,
      members: Array.from(g.members).sort(),
      nExams: list.length,
      firstAt: list[0]?.submitted_at ?? newest.submitted_at,
      lastAt: newest.submitted_at,
      avgRate: mean(rates),
      lastRate: rates.length ? rates[rates.length - 1] : null,
      rates,
      hidden: !!meta.get(key)?.hidden,
      hasMemo: !!(meta.get(key)?.memo ?? "").trim(),
    });
  }
  return out.sort((a, b) => b.lastAt.localeCompare(a.lastAt) || a.name.localeCompare(b.name, "ko"));
}

/** 학생 화면에서 "같은 학생인가요?" 후보 — 이름이 같고 대표 키가 다른 묶음 */
export function mergeCandidates(me: StudentListEntry, all: StudentListEntry[]): StudentListEntry[] {
  const n = me.name.replace(/\s+/g, "");
  return all.filter((o) => o.key !== me.key && o.name.replace(/\s+/g, "") === n);
}

// ---------------------------------------------------------------------
// 학생 한 명 분석
// ---------------------------------------------------------------------

export type ExamResult = {
  examId: string;
  code: string;
  name: string;
  classLabel: string;
  submittedAt: string;
  score: number;
  max: number;
  rate: number | null;
  n: number;
  correct: number;
  wrong: number;
  blank: number;
  /** 같은 시험·같은 반 평균 득점률(학생 본인 포함, 2명 이상일 때만) */
  classAvg: number | null;
  classCount: number;
  /** 같은 시험 전체 평균 득점률(2명 이상일 때만) */
  examAvg: number | null;
  examCount: number;
};

export type Bucket = {
  name: string;
  n: number;
  ok: number;
  wrong: number;
  blank: number;
  earned: number;
  points: number;
  rate: number;
  /** 어느 시험 몇 번이었는지(약점 단원 설명용) */
  refs: { examId: string; label: string; ok: boolean }[];
};

export type Attempt = {
  examId: string;
  examName: string;
  submittedAt: string;
  item: ItemMeta;
  given: string;
  ok: boolean;
  blank: boolean;
};

export type Analysis = {
  exams: ExamResult[];
  totalItems: number;
  okItems: number;
  avgRate: number | null;
  lastRate: number | null;
  trend: { direction: "up" | "down" | "flat" | "none"; slopePerExam: number | null; firstRate: number | null; lastRate: number | null };
  areas: Bucket[];
  units: Bucket[];
  diffs: Bucket[];
  types: Bucket[];
  blankRate: number;
  weakUnits: Bucket[];
  strongAreas: Bucket[];
  areaChanges: { name: string; before: number; after: number; delta: number; nBefore: number; nAfter: number }[];
  easyMisses: Attempt[];
  review: Attempt[];
  advice: string[];
};

export type PeerRow = { exam_id: string; class_label: string; total_score: number };

const UNKNOWN_UNIT = "단원 미상";

function bucketKey(s: string): string {
  return normName(s).replace(/\s+/g, "");
}

function addTo(map: Map<string, Bucket & { names: Map<string, number> }>, rawName: string, a: Attempt) {
  const name = normName(rawName);
  const k = bucketKey(name) || "";
  const b =
    map.get(k) ??
    ({ name, n: 0, ok: 0, wrong: 0, blank: 0, earned: 0, points: 0, rate: 0, refs: [], names: new Map<string, number>() } as Bucket & {
      names: Map<string, number>;
    });
  b.n++;
  if (a.ok) b.ok++;
  else if (a.blank) b.blank++;
  else b.wrong++;
  b.points += a.item.points;
  if (a.ok) b.earned += a.item.points;
  b.refs.push({ examId: a.examId, label: a.item.label, ok: a.ok });
  b.names.set(name, (b.names.get(name) ?? 0) + 1);
  map.set(k, b);
}

function finish(map: Map<string, Bucket & { names: Map<string, number> }>): Bucket[] {
  return Array.from(map.values()).map((b) => {
    // 같은 단원이 띄어쓰기만 다르게 적힌 경우 — 가장 많이 쓰인 표기를 이름으로
    const name = Array.from(b.names.entries()).sort((x, y) => y[1] - x[1])[0]?.[0] ?? b.name;
    const { names: _n, ...rest } = b;
    return { ...rest, name, rate: b.n ? b.ok / b.n : 0 };
  });
}

function pctText(r: number | null): string {
  return r == null ? "-" : `${Math.round(r * 100)}%`;
}

export function analyzeStudent(
  subsIn: SubRow[],
  exams: Map<string, ExamMeta>,
  items: ItemMeta[],
  peers: PeerRow[]
): Analysis {
  const subs = latestPerExam(subsIn);
  const itemIdx = new Map(items.map((i) => [`${i.exam_id}|${i.label}`, i]));

  // 시험별 평균(같은 반 / 전체)
  const peerBy = new Map<string, PeerRow[]>();
  for (const p of peers) {
    const l = peerBy.get(p.exam_id) ?? [];
    l.push(p);
    peerBy.set(p.exam_id, l);
  }

  const attempts: Attempt[] = [];
  const results: ExamResult[] = [];
  for (const s of subs) {
    const exam = exams.get(s.exam_id);
    if (!exam) continue;
    const per = s.per_item ?? [];
    let correct = 0,
      wrong = 0,
      blank = 0;
    for (const p of per) {
      const isBlank = !p.correct && String(p.given ?? "").trim() === "";
      if (p.correct) correct++;
      else if (isBlank) blank++;
      else wrong++;
      const item = itemIdx.get(`${s.exam_id}|${p.item_label}`);
      if (item) attempts.push({ examId: s.exam_id, examName: exam.name, submittedAt: s.submitted_at, item, given: String(p.given ?? ""), ok: !!p.correct, blank: isBlank });
    }
    const pr = peerBy.get(s.exam_id) ?? [];
    const cls = pr.filter((p) => normName(p.class_label) === normName(s.class_label));
    const r = (rows: PeerRow[]) => mean(rows.map((p) => rateOf(p.total_score, exam)).filter((x): x is number => x != null));
    results.push({
      examId: s.exam_id,
      code: exam.code,
      name: exam.name,
      classLabel: normName(s.class_label),
      submittedAt: s.submitted_at,
      score: s.total_score,
      max: exam.max,
      rate: rateOf(s.total_score, exam, per),
      n: per.length || exam.n,
      correct,
      wrong,
      blank,
      classAvg: cls.length >= 2 ? r(cls) : null,
      classCount: cls.length,
      examAvg: pr.length >= 2 ? r(pr) : null,
      examCount: pr.length,
    });
  }

  const rates = results.map((e) => e.rate).filter((x): x is number => x != null);
  const trend = trendOf(rates);

  const areaM = new Map<string, Bucket & { names: Map<string, number> }>();
  const unitM = new Map<string, Bucket & { names: Map<string, number> }>();
  const diffM = new Map<string, Bucket & { names: Map<string, number> }>();
  const typeM = new Map<string, Bucket & { names: Map<string, number> }>();
  for (const a of attempts) {
    if (a.item.area.trim()) addTo(areaM, a.item.area, a);
    addTo(unitM, a.item.unit.trim() || UNKNOWN_UNIT, a);
    addTo(diffM, a.item.difficulty, a);
    addTo(typeM, a.item.type, a);
  }
  const areas = finish(areaM).sort((x, y) => y.n - x.n || x.name.localeCompare(y.name, "ko"));
  const units = finish(unitM).sort((x, y) => x.rate - y.rate || y.n - x.n);
  const diffs = DIFFS.map((d) => finish(diffM).find((b) => b.name === d)).filter((b): b is Bucket => !!b);
  const types = finish(typeM).sort((x, y) => x.name.localeCompare(y.name, "ko"));

  const okItems = attempts.filter((a) => a.ok).length;
  const overall = attempts.length ? okItems / attempts.length : 0;
  const blankRate = attempts.length ? attempts.filter((a) => a.blank).length / attempts.length : 0;

  // 약점 단원: 두 번 이상 나온 단원 중 정답률이 전체보다 낮거나 70% 미만, 많이 틀린 순
  const weakUnits = units
    .filter((u) => u.name !== UNKNOWN_UNIT && u.n >= 2 && u.ok < u.n && (u.rate < overall || u.rate < 0.7))
    .sort((x, y) => x.rate - y.rate || y.n - x.n)
    .slice(0, 5);
  const strongAreas = areas.filter((a) => a.n >= 3 && a.rate >= Math.max(0.8, overall)).sort((x, y) => y.rate - x.rate).slice(0, 3);

  // 영역별 변화: 시험을 시간순으로 앞/뒤 절반으로 나눠 비교(각 쪽 2문항 이상)
  const areaChanges: Analysis["areaChanges"] = [];
  if (results.length >= 2) {
    const half = Math.floor(results.length / 2);
    const early = new Set(results.slice(0, half).map((e) => e.examId));
    const late = new Set(results.slice(half).map((e) => e.examId));
    const by = new Map<string, { name: string; b: [number, number]; a: [number, number] }>();
    for (const at of attempts) {
      const nm = normName(at.item.area);
      if (!nm) continue;
      const k = bucketKey(nm);
      const e = by.get(k) ?? { name: nm, b: [0, 0], a: [0, 0] };
      if (early.has(at.examId)) {
        e.b[1]++;
        if (at.ok) e.b[0]++;
      } else if (late.has(at.examId)) {
        e.a[1]++;
        if (at.ok) e.a[0]++;
      }
      by.set(k, e);
    }
    for (const e of by.values()) {
      if (e.b[1] >= 2 && e.a[1] >= 2) {
        const before = e.b[0] / e.b[1];
        const after = e.a[0] / e.a[1];
        areaChanges.push({ name: e.name, before, after, delta: after - before, nBefore: e.b[1], nAfter: e.a[1] });
      }
    }
    areaChanges.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  }

  const easyMisses = attempts.filter((a) => !a.ok && (a.item.difficulty === "하" || a.item.difficulty === "중하"));

  // 다시 풀 문항: 약점 단원의 틀린·무응답 문항(쉬운 것부터, 최근 것 먼저), 그다음 쉬운데 틀린 문항 — 최대 10개
  const weakSet = new Set(weakUnits.map((u) => bucketKey(u.name)));
  const missed = attempts.filter((a) => !a.ok);
  const dIdx = (a: Attempt) => DIFFS.indexOf(a.item.difficulty);
  const pick = (xs: Attempt[]) => [...xs].sort((a, b) => dIdx(a) - dIdx(b) || b.submittedAt.localeCompare(a.submittedAt));
  const review: Attempt[] = [];
  const seen = new Set<string>();
  for (const a of [...pick(missed.filter((m) => weakSet.has(bucketKey(m.item.unit)))), ...pick(easyMisses), ...pick(missed)]) {
    const k = `${a.examId}|${a.item.label}`;
    if (seen.has(k)) continue;
    seen.add(k);
    review.push(a);
    if (review.length >= 10) break;
  }

  const base: Omit<Analysis, "advice"> = {
    exams: results,
    totalItems: attempts.length,
    okItems,
    avgRate: mean(rates),
    lastRate: rates.length ? rates[rates.length - 1] : null,
    trend,
    areas,
    units,
    diffs,
    types,
    blankRate,
    weakUnits,
    strongAreas,
    areaChanges,
    easyMisses,
    review,
  };
  return { ...base, advice: buildAdvice(base) };
}

/** 득점률 추이: 3회 이상이면 최소제곱 기울기(시험 1회당), 2회면 차이. 1회당 3%p 이상이면 오름/내림. */
export function trendOf(rates: number[]): Analysis["trend"] {
  if (rates.length < 2) return { direction: "none", slopePerExam: null, firstRate: rates[0] ?? null, lastRate: rates[0] ?? null };
  let slope: number;
  if (rates.length === 2) slope = rates[1] - rates[0];
  else {
    const n = rates.length;
    const mx = (n - 1) / 2;
    const my = rates.reduce((a, b) => a + b, 0) / n;
    let num = 0,
      den = 0;
    rates.forEach((y, x) => {
      num += (x - mx) * (y - my);
      den += (x - mx) * (x - mx);
    });
    slope = den ? num / den : 0;
  }
  const direction = slope >= 0.03 ? "up" : slope <= -0.03 ? "down" : "flat";
  return { direction, slopePerExam: slope, firstRate: rates[0], lastRate: rates[rates.length - 1] };
}

/** 규칙으로 만드는 종합 의견(상담·보고서용). 사실만 말하고 등급·예측은 하지 않는다. */
export function buildAdvice(a: Omit<Analysis, "advice">): string[] {
  const out: string[] = [];
  const n = a.exams.length;
  if (!n) return ["아직 채점된 시험이 없습니다."];
  if (n === 1) out.push(`지금까지 시험 1회를 봤고 득점률은 ${pctText(a.lastRate)}입니다. 시험이 더 쌓이면 추이와 약점이 더 정확해집니다.`);
  else {
    const t = a.trend;
    const dir =
      t.direction === "up"
        ? `점수가 오르는 흐름입니다(첫 시험 ${pctText(t.firstRate)} → 최근 ${pctText(t.lastRate)}).`
        : t.direction === "down"
          ? `최근 점수가 내려가는 흐름이라 점검이 필요합니다(첫 시험 ${pctText(t.firstRate)} → 최근 ${pctText(t.lastRate)}).`
          : `점수가 비슷한 수준을 유지하고 있습니다(첫 시험 ${pctText(t.firstRate)} → 최근 ${pctText(t.lastRate)}).`;
    out.push(`시험 ${n}회 평균 득점률은 ${pctText(a.avgRate)}입니다. ${dir}`);
  }
  if (a.strongAreas.length) out.push(`강한 영역: ${a.strongAreas.map((s) => `${s.name}(${pctText(s.rate)})`).join(", ")}.`);
  if (a.weakUnits.length)
    out.push(
      `우선 복습할 단원: ${a.weakUnits
        .slice(0, 3)
        .map((u) => `${u.name}(${u.ok}/${u.n})`)
        .join(", ")}.`
    );
  const easy = a.diffs.filter((d) => d.name === "하" || d.name === "중하");
  const easyN = easy.reduce((s, d) => s + d.n, 0);
  const easyOk = easy.reduce((s, d) => s + d.ok, 0);
  const hard = a.diffs.filter((d) => d.name === "중상" || d.name === "상");
  const hardN = hard.reduce((s, d) => s + d.n, 0);
  const hardOk = hard.reduce((s, d) => s + d.ok, 0);
  if (easyN >= 3 && easyOk / easyN < 0.85)
    out.push(
      `쉬운 문항(하·중하) ${easyN}개 중 ${easyN - easyOk}개를 놓쳤습니다. 계산 실수와 문제 조건 확인 습관을 잡으면 점수를 가장 빨리 올릴 수 있습니다.`
    );
  else if (hardN >= 3 && hardOk / hardN < 0.5 && easyN >= 3)
    out.push(`기본 문항은 안정적입니다(하·중하 ${easyOk}/${easyN}). 어려운 문항(중상·상 ${hardOk}/${hardN})을 따로 연습하면 다음 단계로 올라갈 수 있습니다.`);
  if (a.totalItems >= 10 && a.blankRate >= 0.1)
    out.push(`무응답이 전체 문항의 ${pctText(a.blankRate)}입니다. 모르는 문제는 넘기고 돌아오는 시간 배분 연습이 필요합니다.`);
  const mc = a.types.find((t) => t.name === "객관식");
  const sa = a.types.find((t) => t.name === "주관식");
  if (mc && sa && mc.n >= 5 && sa.n >= 3 && mc.rate - sa.rate >= 0.2)
    out.push(`주관식 정답률(${pctText(sa.rate)})이 객관식(${pctText(mc.rate)})보다 크게 낮습니다. 풀이를 끝까지 써서 답을 내는 연습이 필요합니다.`);
  const up = a.areaChanges.filter((c) => c.delta >= 0.2).slice(0, 2);
  const down = a.areaChanges.filter((c) => c.delta <= -0.2).slice(0, 2);
  if (up.length) out.push(`좋아진 영역: ${up.map((c) => `${c.name}(${pctText(c.before)} → ${pctText(c.after)})`).join(", ")}.`);
  if (down.length) out.push(`떨어진 영역: ${down.map((c) => `${c.name}(${pctText(c.before)} → ${pctText(c.after)})`).join(", ")}.`);
  return out;
}

// ---------------------------------------------------------------------
// 그래프(SVG 문자열) — 화면과 PDF가 같은 그림을 쓴다
// ---------------------------------------------------------------------

function xmlEsc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function shortExamName(name: string, max = 10): string {
  const t = normName(name).replace(/_/g, " ");
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

/** 득점률 추이 꺾은선. 반 평균(있으면)은 회색 점선. */
export function trendSvg(
  exams: Pick<ExamResult, "name" | "submittedAt" | "rate" | "classAvg">[],
  opts: { width?: number; height?: number; font?: string } = {}
): string {
  const W = opts.width ?? 680;
  const H = opts.height ?? 230;
  const font = opts.font ?? "'Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif";
  const L = 40,
    R = 16,
    T = 18,
    B = 48;
  const iw = W - L - R;
  const ih = H - T - B;
  const n = exams.length;
  // 양 끝 시험 이름이 잘리지 않게 안쪽으로 조금 들여서 찍는다
  const pad = n <= 1 ? 0 : Math.min(48, iw / (2 * n));
  const x = (i: number) => L + (n <= 1 ? iw / 2 : pad + ((iw - 2 * pad) * i) / (n - 1));
  const y = (r: number) => T + ih * (1 - r);
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${xmlEsc(font)}">`);
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`);
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    parts.push(`<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="${t === 0 ? "#94a3b8" : "#e2e8f0"}" stroke-width="1"/>`);
    parts.push(`<text x="${L - 6}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="#64748b">${Math.round(t * 100)}%</text>`);
  }
  const cls = exams.map((e, i) => (e.classAvg != null ? [x(i), y(e.classAvg)] : null));
  const clsPts = cls.filter((p): p is number[] => !!p);
  if (clsPts.length >= 2)
    parts.push(`<polyline points="${clsPts.map((p) => p.join(",")).join(" ")}" fill="none" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="4 4"/>`);
  for (const p of clsPts) parts.push(`<circle cx="${p[0]}" cy="${p[1]}" r="2.5" fill="#94a3b8"/>`);
  const pts = exams.map((e, i) => (e.rate != null ? [x(i), y(e.rate), e.rate] : null)).filter((p): p is number[] => !!p);
  if (pts.length >= 2) parts.push(`<polyline points="${pts.map((p) => `${p[0]},${p[1]}`).join(" ")}" fill="none" stroke="#2563eb" stroke-width="2.5"/>`);
  for (const p of pts) {
    parts.push(`<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="#2563eb" stroke="#ffffff" stroke-width="1.5"/>`);
    const ly = p[1] < T + 14 ? p[1] + 16 : p[1] - 9;
    parts.push(`<text x="${p[0]}" y="${ly}" text-anchor="middle" font-size="11" font-weight="700" fill="#1d4ed8">${Math.round(p[2] * 100)}</text>`);
  }
  const step = n > 8 ? Math.ceil(n / 8) : 1;
  exams.forEach((e, i) => {
    if (i % step !== 0 && i !== n - 1) return;
    const d = new Date(e.submittedAt);
    const md = isNaN(d.getTime()) ? "" : `${d.getMonth() + 1}/${d.getDate()}`;
    parts.push(`<text x="${x(i)}" y="${H - B + 18}" text-anchor="middle" font-size="10.5" fill="#334155">${xmlEsc(shortExamName(e.name, n > 5 ? 8 : 12))}</text>`);
    parts.push(`<text x="${x(i)}" y="${H - B + 32}" text-anchor="middle" font-size="10" fill="#64748b">${md}</text>`);
  });
  parts.push("</svg>");
  return parts.join("");
}

/** 목록용 아주 작은 추이 그림 */
export function sparkSvg(rates: number[], w = 84, h = 22): string {
  if (!rates.length) return "";
  const n = rates.length;
  const x = (i: number) => (n <= 1 ? w / 2 : 2 + ((w - 4) * i) / (n - 1));
  const y = (r: number) => 2 + (h - 4) * (1 - r);
  const pts = rates.map((r, i) => `${x(i).toFixed(1)},${y(r).toFixed(1)}`).join(" ");
  const last = rates[n - 1];
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
    (n >= 2 ? `<polyline points="${pts}" fill="none" stroke="#2563eb" stroke-width="1.5"/>` : "") +
    `<circle cx="${x(n - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="2.2" fill="#2563eb"/></svg>`
  );
}
