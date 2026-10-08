import "server-only";
import { fetchAllIn } from "@/lib/supabase/fetchAll";
import { logicTypeOf } from "@/lib/similar/logicTypes";
import { diffIndex, examTwins, hash32, pickSimilar, targetsOf, type PoolItem, type Tier } from "@/lib/similar/recommend";

// 오답 유사문제 화면(/r/[sid])과 그 화면이 부르는 API(시험지 쪽·답 확인), 그리고 선생님이 유사문제를 고르는 화면
// (직원 /students/similar/[sid], 과외 /tutor/students/similar/[sid])이 함께 쓰는 서버 계산.
// 학생 로그인이 없으므로 제출 id(추측할 수 없는 uuid)가 곧 열쇠다. 서비스롤 클라이언트로 읽되, 학생 화면으로는
// 문항 id·시험 이름·번호·난이도·유형 이름만 내려 보내고 정답·풀이는 학생이 "확인"을 누를 때 그 문항 것만 준다.
//
// 2026-10-05 원장님 "학생이 아니라 선생님이 선택할 수 있게": 학생 화면은 선생님이 고른 문제(submissions.similar_picks,
// 0051)만 보여 준다. 고르기 전에는 pending. 고르는 화면은 같은 유형의 쓸 수 있는 문항을 전부 후보로 보여 주고,
// 예전 자동 추천(쉬운 것 1 → 같은 것 2 → 어려운 것 1, lib/similar/recommend.ts)은 "추천" 표시 + 처음 체크 상태로 쓴다.

type Client = any;

export type SimilarCard = {
  id: string;
  examName: string;
  label: string;
  difficulty: string;
  type: "객관식" | "주관식" | "";
  sourcePage: number;
  bbox: { x0: number; y0: number; x1: number; y1: number } | null;
  tier: Tier;
};

export type SimilarGroup = {
  label: string;
  kind: "wrong" | "blank" | "guessed";
  given: string;
  difficulty: string;
  unit: string;
  logicName: string | null;
  logic: string | null;
  /** 원래 문항(학생이 틀린 것) — 쪽을 알면 잘라 보여 줌 */
  original: { id: string; sourcePage: number; bbox: SimilarCard["bbox"] } | null;
  cards: SimilarCard[];
};

export type SimilarPage = {
  submissionId: string;
  examName: string;
  examCode: string;
  total: number;
  /** 다시 볼 문항(틀림·무응답·찍어서 맞힘) 수 */
  targets: number;
  /** 선생님이 아직 유사문제를 고르지 않음 */
  pending: boolean;
  groups: SimilarGroup[];
};

export type PickCandidate = SimilarCard & { recommended: boolean };
export type PickGroup = Omit<SimilarGroup, "cards"> & { candidates: PickCandidate[]; picked: string[] };
export type PickPage = {
  submissionId: string;
  examName: string;
  studentName: string;
  classLabel: string;
  tutorId: string | null;
  /** 선생님이 저장한 적이 있음(없으면 picked = 추천) */
  saved: boolean;
  pickedAt: string | null;
  groups: PickGroup[];
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 고르는 화면에서 틀린 문항 하나당 보여 줄 후보 수 상한(추천은 항상 포함) */
const MAX_CANDIDATES = 40;

function boxOf(r: any): SimilarCard["bbox"] {
  return [r.bbox_x0, r.bbox_y0, r.bbox_x1, r.bbox_y1].every((v) => typeof v === "number")
    ? { x0: r.bbox_x0, y0: r.bbox_y0, x1: r.bbox_x1, y1: r.bbox_y1 }
    : null;
}

function tierOf(src: string, d: string): Tier {
  const a = diffIndex(src);
  const b = diffIndex(d);
  return b < a ? "easier" : b > a ? "harder" : "same";
}

/** similar_picks 값 다듬기: {번호: [uuid…]}만 남긴다 */
export function cleanPicks(v: unknown): Record<string, string[]> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, string[]> = {};
  for (const [k, arr] of Object.entries(v as Record<string, unknown>)) {
    if (!Array.isArray(arr) || k.length > 40) continue;
    const ids = Array.from(new Set(arr.map((x) => String(x)).filter((x) => UUID_RE.test(x)))).slice(0, 12);
    out[k] = ids;
  }
  return out;
}

type Core = {
  sub: any;
  exam: any;
  perItem: { item_label: string; given: string; correct: boolean; guessed?: boolean }[];
  targets: { label: string; kind: SimilarGroup["kind"] }[];
  ownBy: Map<string, any>;
  keyBy: Map<string, any>;
  pool: PoolItem[];
  poolRow: Map<string, any>;
  examOf: Map<string, any>;
  /** 학생 시험의 대표 id(같은 시험지를 두 번 올렸으면 묶음의 대표) */
  self: string;
  picks: Record<string, string[]> | null;
};

async function loadCore(admin: Client, submissionId: string): Promise<Core | null> {
  if (!UUID_RE.test(submissionId)) return null;
  const { data: sub } = await admin
    .from("submissions")
    .select("id, exam_id, class_label, student_name, tutor_id, similar_picks, similar_picked_at, grading_results(per_item)")
    .eq("id", submissionId)
    .maybeSingle();
  if (!sub) return null;
  const gr = Array.isArray(sub.grading_results) ? sub.grading_results[0] : sub.grading_results;
  const perItem = (gr?.per_item ?? []) as Core["perItem"];

  const [{ data: exam }, { data: own }, { data: ownKeys }] = await Promise.all([
    admin.from("exams").select("id, code, name, folder_year, folder_grade").eq("id", sub.exam_id).maybeSingle(),
    admin
      .from("item_explanations")
      .select("id, item_label, difficulty, unit, logic_type, source_page, bbox_x0, bbox_y0, bbox_x1, bbox_y1")
      .eq("exam_id", sub.exam_id),
    admin.from("answer_key").select("item_label, correct_answers, sort_order").eq("exam_id", sub.exam_id),
  ]);
  if (!exam) return null;
  const ownBy = new Map<string, any>(((own as any[]) ?? []).map((r) => [String(r.item_label), r]));
  const keyBy = new Map<string, any>(((ownKeys as any[]) ?? []).map((k) => [String(k.item_label), k]));
  const sortOf = (label: string) => Number(keyBy.get(label)?.sort_order ?? 0);

  const targets = targetsOf(perItem).sort((a, b) => sortOf(a.label) - sortOf(b.label));
  const types = Array.from(
    new Set(targets.map((t) => ownBy.get(t.label)?.logic_type).filter((x): x is string => typeof x === "string" && !!x))
  );

  // 후보: 같은 유형의 모든 문항(유형 수가 적어 수백 개 이내)
  const pool: PoolItem[] = [];
  const poolRow = new Map<string, any>();
  const examOf = new Map<string, any>();
  let canon = new Map<string, string>();
  if (types.length) {
    const { data: rows } = await fetchAllIn(types, (chunk, a, b) =>
      admin
        .from("item_explanations")
        .select("id, exam_id, item_label, difficulty, logic_type, exam_error_suspected, review_confirmed, source_page, bbox_x0, bbox_y0, bbox_x1, bbox_y1")
        .in("logic_type", chunk)
        .order("id")
        .range(a, b)
    );
    const examIds = Array.from(new Set(((rows as any[]) ?? []).map((r) => r.exam_id)));
    const [{ data: exs }, { data: keys }] = await Promise.all([
      fetchAllIn(examIds, (chunk, a, b) =>
        admin.from("exams").select("id, name, status, folder_year, folder_grade").in("id", chunk).order("id").range(a, b)
      ),
      fetchAllIn(examIds, (chunk, a, b) =>
        admin.from("answer_key").select("id, exam_id, item_label, correct_answers, type").in("exam_id", chunk).order("id").range(a, b)
      ),
    ]);
    for (const e of (exs as any[]) ?? []) examOf.set(e.id, e);
    const keyOf = new Map(((keys as any[]) ?? []).map((k) => [`${k.exam_id}|${k.item_label}`, k]));
    // 같은 시험지를 두 번 올린 시험은 하나로(대표 시험 문항만 후보로) — 학생 시험의 쌍둥이도 함께 뺀다
    const answersOf = new Map<string, string[]>();
    for (const k of (keys as any[]) ?? []) {
      const arr = answersOf.get(k.exam_id) ?? [];
      arr.push(String(k.correct_answers ?? ""));
      answersOf.set(k.exam_id, arr);
    }
    answersOf.set(exam.id, ((ownKeys as any[]) ?? []).map((k) => String(k.correct_answers ?? "")));
    canon = examTwins(
      [exam, ...Array.from(examOf.values()).filter((e) => e.id !== exam.id)].map((e) => ({
        id: e.id,
        year: e.folder_year ?? null,
        grade: e.folder_grade ?? null,
        answers: answersOf.get(e.id) ?? [],
      }))
    );
    for (const r of (rows as any[]) ?? []) {
      const e = examOf.get(r.exam_id);
      if (!e) continue;
      if ((canon.get(r.exam_id) ?? r.exam_id) !== r.exam_id) continue; // 쌍둥이 시험(대표가 아님)
      const k = keyOf.get(`${r.exam_id}|${r.item_label}`);
      poolRow.set(r.id, { ...r, type: k?.type ?? "" });
      pool.push({
        id: r.id,
        examId: r.exam_id,
        label: String(r.item_label),
        logicType: r.logic_type,
        difficulty: String(r.difficulty ?? "중"),
        correctAnswers: String(k?.correct_answers ?? ""),
        year: e.folder_year ?? null,
        grade: e.folder_grade ?? null,
        // 정답이 확정된 문항(2026-10-05 0050부터 열린 시험에도 미확정 문항이 있음)·검수대기 아님·오류 의심 아님·
        // 정답 있음·쪽을 앎
        usable: e.status !== "검수대기" && !!r.review_confirmed && !r.exam_error_suspected && !!k && r.source_page != null,
      });
    }
  }
  return {
    sub,
    exam,
    perItem,
    targets,
    ownBy,
    keyBy,
    pool,
    poolRow,
    examOf,
    self: canon.get(exam.id) ?? exam.id,
    picks: cleanPicks(sub.similar_picks),
  };
}

function cardOf(c: Core, item: PoolItem, tier: Tier): SimilarCard {
  const r = c.poolRow.get(item.id);
  return {
    id: item.id,
    examName: shortExamName(c.examOf.get(item.examId)?.name ?? ""),
    label: item.label,
    difficulty: item.difficulty,
    type: r?.type === "객관식" || r?.type === "주관식" ? r.type : "",
    sourcePage: Number(r?.source_page),
    bbox: boxOf(r),
    tier,
  };
}

function groupHead(c: Core, t: Core["targets"][number]): Omit<SimilarGroup, "cards"> {
  const o = c.ownBy.get(t.label);
  const lt = logicTypeOf(o?.logic_type);
  const given = c.perItem.find((p) => String(p.item_label) === t.label)?.given ?? "";
  return {
    label: t.label,
    kind: t.kind,
    given: String(given ?? ""),
    difficulty: String(o?.difficulty ?? ""),
    unit: String(o?.unit ?? ""),
    logicName: lt?.name ?? null,
    logic: lt?.logic ?? null,
    original: o && o.source_page != null ? { id: o.id, sourcePage: Number(o.source_page), bbox: boxOf(o) } : null,
  };
}

/** 틀린 문항 하나에 쓸 수 있는 후보 전부(같은 유형·다른 시험·쓸 수 있는 것) */
function candidatesFor(c: Core, label: string): PoolItem[] {
  const lt = c.ownBy.get(label)?.logic_type;
  if (!lt) return [];
  return c.pool.filter((p) => p.usable && p.logicType === lt && p.examId !== c.self);
}

/** 자동 추천(예전 학생 화면 규칙) — 틀린 문항 순서대로, 화면 안에서 겹치지 않게 */
function recommendAll(c: Core): Map<string, { item: PoolItem; tier: Tier }[]> {
  const used = new Set<string>();
  const out = new Map<string, { item: PoolItem; tier: Tier }[]>();
  for (const t of c.targets) {
    const o = c.ownBy.get(t.label);
    out.set(
      t.label,
      o
        ? pickSimilar(
            {
              label: t.label,
              logicType: o.logic_type ?? null,
              difficulty: String(o.difficulty ?? "중"),
              correctAnswers: String(c.keyBy.get(t.label)?.correct_answers ?? ""),
              year: c.exam.folder_year ?? null,
              grade: c.exam.folder_grade ?? null,
            },
            c.self,
            c.pool,
            c.sub.id,
            used
          )
        : []
    );
  }
  return out;
}

/** 학생 화면: 제출 하나의 오답 유사문제(선생님이 고른 것만). 제출이 없거나 id 모양이 틀리면 null. */
export async function loadSimilarPage(admin: Client, submissionId: string): Promise<SimilarPage | null> {
  const c = await loadCore(admin, submissionId);
  if (!c) return null;
  const base = { submissionId, examName: c.exam.name, examCode: c.exam.code, total: c.perItem.length, targets: c.targets.length };
  if (!c.picks) return { ...base, pending: true, groups: [] };
  const groups: SimilarGroup[] = [];
  for (const t of c.targets) {
    const ids = c.picks[t.label] ?? [];
    if (!ids.length) continue;
    const head = groupHead(c, t);
    const allowed = new Map(candidatesFor(c, t.label).map((p) => [p.id, p]));
    const cards = ids
      .map((id) => allowed.get(id))
      .filter((p): p is PoolItem => !!p)
      .map((p) => cardOf(c, p, tierOf(head.difficulty || "중", p.difficulty)));
    const order: Tier[] = ["easier", "same", "harder"];
    cards.sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier) || diffIndex(a.difficulty) - diffIndex(b.difficulty));
    if (cards.length) groups.push({ ...head, cards });
  }
  return { ...base, pending: false, groups };
}

/** 선생님 고르기 화면: 틀린 문항마다 후보 전부 + 추천 표시 + 지금 고른 것. */
export async function loadPickPage(admin: Client, submissionId: string): Promise<PickPage | null> {
  const c = await loadCore(admin, submissionId);
  if (!c) return null;
  const rec = recommendAll(c);
  const groups: PickGroup[] = c.targets.map((t) => {
    const head = groupHead(c, t);
    const src = head.difficulty || "중";
    const recIds = new Set((rec.get(t.label) ?? []).map((x) => x.item.id));
    const d = diffIndex(src);
    const all = candidatesFor(c, t.label).sort(
      (a, b) =>
        Number(recIds.has(b.id)) - Number(recIds.has(a.id)) ||
        Math.abs(diffIndex(a.difficulty) - d) - Math.abs(diffIndex(b.difficulty) - d) ||
        diffIndex(a.difficulty) - diffIndex(b.difficulty) ||
        hash32(c.sub.id + "|" + t.label + "|" + a.id) - hash32(c.sub.id + "|" + t.label + "|" + b.id)
    );
    const candidates = all.slice(0, Math.max(MAX_CANDIDATES, recIds.size)).map((p) => ({
      ...cardOf(c, p, tierOf(src, p.difficulty)),
      recommended: recIds.has(p.id),
    }));
    const valid = new Set(candidates.map((x) => x.id));
    const picked = c.picks ? (c.picks[t.label] ?? []).filter((id) => valid.has(id)) : Array.from(recIds);
    return { ...head, candidates, picked };
  });
  return {
    submissionId,
    examName: c.exam.name,
    studentName: String(c.sub.student_name ?? ""),
    classLabel: String(c.sub.class_label ?? ""),
    tutorId: c.sub.tutor_id ?? null,
    saved: !!c.picks,
    pickedAt: c.sub.similar_picked_at ?? null,
    groups,
  };
}

/** 이 제출 화면에서 열어 볼 수 있는 문항인가(유사문제로 고른 것, 또는 학생이 틀린 원래 문항) */
export function allowedItem(page: SimilarPage, itemId: string): { kind: "similar" | "original"; card?: SimilarCard } | null {
  for (const g of page.groups) {
    if (g.original?.id === itemId) return { kind: "original" };
    const c = g.cards.find((x) => x.id === itemId);
    if (c) return { kind: "similar", card: c };
  }
  return null;
}

/** 고르는 화면에서 열어 볼 수 있는 문항인가(후보 또는 원래 문항) */
export function allowedPickItem(page: PickPage, itemId: string): boolean {
  return page.groups.some((g) => g.original?.id === itemId || g.candidates.some((x) => x.id === itemId));
}

/** "서울_강남구_경기고등학교 1학년 2025년 2학기 공통수학2 중간_" → "경기고등학교 1학년 2025년 2학기 공통수학2 중간" */
export function shortExamName(name: string): string {
  return String(name ?? "")
    .normalize("NFC")
    .replace(/^(서울|제주)[_ ][^_ ]+[_ ]/, "")
    .replace(/_\s*(\(\d+\))?\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

// 2026-10-08 최적화: 학생 화면(/r)은 문제 그림마다(원래 문항 + 고른 유사문제 수만큼) 그림 API를 동시에 부르고, 그때마다
// 위의 loadCore(같은 유형 후보 수백~수천 줄 + 그 시험들의 정답표)를 처음부터 다시 했다. 그림·답 확인 API에서는 같은
// 제출의 계산 결과를 잠깐(60초) 서버에 두고 같이 쓴다. 열쇠에 similar_picked_at을 넣어, 선생님이 고른 문제를 바꾸면
// 바로 새로 계산한다. 화면(page) 자체와 고르기 저장은 지금처럼 매번 새로 계산한다.
const MEMO_MS = 60_000;
const MEMO_MAX = 300;
const memo = new Map<string, { at: number; value: Promise<unknown> }>();

async function memoized<T>(admin: Client, kind: string, submissionId: string, load: () => Promise<T>): Promise<T> {
  if (!UUID_RE.test(submissionId)) return load();
  const { data } = await admin.from("submissions").select("similar_picked_at").eq("id", submissionId).maybeSingle();
  if (!data) return load();
  const key = `${kind}|${submissionId}|${data.similar_picked_at ?? ""}`;
  const now = Date.now();
  const hit = memo.get(key);
  if (hit && now - hit.at < MEMO_MS) return hit.value as Promise<T>;
  if (memo.size >= MEMO_MAX) {
    for (const [k, v] of Array.from(memo)) if (now - v.at >= MEMO_MS) memo.delete(k);
    if (memo.size >= MEMO_MAX) memo.clear();
  }
  const value = load();
  memo.set(key, { at: now, value });
  value.catch(() => memo.delete(key)); // 실패한 계산은 두지 않는다
  return value;
}

/** 그림·답 확인 API용 — loadSimilarPage와 같은 결과를 60초 동안 같이 쓴다. */
export function loadSimilarPageShared(admin: Client, submissionId: string): Promise<SimilarPage | null> {
  return memoized(admin, "r", submissionId, () => loadSimilarPage(admin, submissionId));
}

/** 고르는 화면의 그림 API용 — loadPickPage와 같은 결과를 60초 동안 같이 쓴다. */
export function loadPickPageShared(admin: Client, submissionId: string): Promise<PickPage | null> {
  return memoized(admin, "pick", submissionId, () => loadPickPage(admin, submissionId));
}
