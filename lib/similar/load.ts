import "server-only";
import { fetchAllIn } from "@/lib/supabase/fetchAll";
import { logicTypeOf } from "@/lib/similar/logicTypes";
import { examTwins, pickSimilar, targetsOf, type PoolItem, type Tier } from "@/lib/similar/recommend";

// 오답 유사문제 화면(/r/[sid])과 그 화면이 부르는 API(시험지 쪽·답 확인)가 함께 쓰는 서버 계산.
// 학생 로그인이 없으므로 제출 id(추측할 수 없는 uuid)가 곧 열쇠다. 서비스롤 클라이언트로 읽되, 화면으로는
// 문항 id·시험 이름·번호·난이도·유형 이름만 내려 보내고 정답·풀이는 학생이 "확인"을 누를 때 그 문항 것만 준다.

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
  groups: SimilarGroup[];
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function boxOf(r: any): SimilarCard["bbox"] {
  return [r.bbox_x0, r.bbox_y0, r.bbox_x1, r.bbox_y1].every((v) => typeof v === "number")
    ? { x0: r.bbox_x0, y0: r.bbox_y0, x1: r.bbox_x1, y1: r.bbox_y1 }
    : null;
}

/** 제출 하나의 오답 유사문제 전체. 제출이 없거나 id 모양이 틀리면 null. */
export async function loadSimilarPage(admin: Client, submissionId: string): Promise<SimilarPage | null> {
  if (!UUID_RE.test(submissionId)) return null;
  const { data: sub } = await admin
    .from("submissions")
    .select("id, exam_id, grading_results(per_item)")
    .eq("id", submissionId)
    .maybeSingle();
  if (!sub) return null;
  const gr = Array.isArray(sub.grading_results) ? sub.grading_results[0] : sub.grading_results;
  const perItem = (gr?.per_item ?? []) as { item_label: string; given: string; correct: boolean; guessed?: boolean }[];

  const [{ data: exam }, { data: own }, { data: ownKeys }] = await Promise.all([
    admin.from("exams").select("id, code, name, folder_year, folder_grade").eq("id", sub.exam_id).maybeSingle(),
    admin
      .from("item_explanations")
      .select("id, item_label, difficulty, unit, logic_type, source_page, bbox_x0, bbox_y0, bbox_x1, bbox_y1")
      .eq("exam_id", sub.exam_id),
    admin.from("answer_key").select("item_label, correct_answers, sort_order").eq("exam_id", sub.exam_id),
  ]);
  if (!exam) return null;
  const ownBy = new Map(((own as any[]) ?? []).map((r) => [String(r.item_label), r]));
  const keyBy = new Map(((ownKeys as any[]) ?? []).map((k) => [String(k.item_label), k]));
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
        // 정답이 확정된 시험(검수대기 아님)·오류 의심 아님·정답 있음·쪽을 앎
        usable: e.status !== "검수대기" && !r.exam_error_suspected && !!k && r.source_page != null,
      });
    }
  }

  const used = new Set<string>();
  const groups: SimilarGroup[] = targets.map((t) => {
    const o = ownBy.get(t.label);
    const lt = logicTypeOf(o?.logic_type);
    const picks = o
      ? pickSimilar(
          {
            label: t.label,
            logicType: o.logic_type ?? null,
            difficulty: String(o.difficulty ?? "중"),
            correctAnswers: String(keyBy.get(t.label)?.correct_answers ?? ""),
            year: exam.folder_year ?? null,
            grade: exam.folder_grade ?? null,
          },
          canon.get(exam.id) ?? exam.id,
          pool,
          submissionId,
          used
        )
      : [];
    const given = perItem.find((p) => String(p.item_label) === t.label)?.given ?? "";
    return {
      label: t.label,
      kind: t.kind,
      given: String(given ?? ""),
      difficulty: String(o?.difficulty ?? ""),
      unit: String(o?.unit ?? ""),
      logicName: lt?.name ?? null,
      logic: lt?.logic ?? null,
      original: o && o.source_page != null ? { id: o.id, sourcePage: Number(o.source_page), bbox: boxOf(o) } : null,
      cards: picks.map(({ item, tier }) => {
        const r = poolRow.get(item.id);
        return {
          id: item.id,
          examName: shortExamName(examOf.get(item.examId)?.name ?? ""),
          label: item.label,
          difficulty: item.difficulty,
          type: r?.type === "객관식" || r?.type === "주관식" ? r.type : "",
          sourcePage: Number(r?.source_page),
          bbox: boxOf(r),
          tier,
        };
      }),
    };
  });

  return { submissionId, examName: exam.name, examCode: exam.code, total: perItem.length, groups };
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

/** "서울_강남구_경기고등학교 1학년 2025년 2학기 공통수학2 중간_" → "경기고등학교 1학년 2025년 2학기 공통수학2 중간" */
export function shortExamName(name: string): string {
  return String(name ?? "")
    .normalize("NFC")
    .replace(/^(서울|제주)[_ ][^_ ]+[_ ]/, "")
    .replace(/_\s*(\(\d+\))?\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}
