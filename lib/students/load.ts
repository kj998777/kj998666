import "server-only";
import { fetchAllIn, fetchAllPages } from "@/lib/supabase/fetchAll";
import { personLabel } from "@/lib/profile/label";
import {
  analyzeStudent,
  autoKey,
  groupStudents,
  makeResolver,
  type Analysis,
  type ExamMeta,
  type ItemMeta,
  type KeyRow,
  type StudentListEntry,
  type SubRow,
} from "@/lib/students/analysis";

// 학생 분석 화면용 읽기(직원 세션 그대로 — RLS가 직원만 허용). 계산은 lib/students/analysis.ts.

type Client = any;

export type StudentIndex = {
  entries: StudentListEntry[];
  exams: Map<string, ExamMeta>;
  subs: SubRow[];
  keyRows: KeyRow[];
  /** student_keys 표가 없으면(0039 전) false — 합치기·숨기기·메모 버튼을 감춘다 */
  keysAvailable: boolean;
  tutorLabel: Map<string, string>;
};

export async function loadStudentIndex(supabase: Client): Promise<StudentIndex> {
  const [examsRes, keysRes, subsRes, skRes] = await Promise.all([
    fetchAllPages((a, b) => supabase.from("exams").select("id, code, name").order("id").range(a, b)),
    fetchAllPages((a, b) => supabase.from("answer_key").select("id, exam_id, points").order("id").range(a, b)),
    fetchAllPages((a, b) =>
      supabase
        .from("submissions")
        .select("id, exam_id, class_label, student_name, tutor_id, submitted_at, grading_results(total_score)")
        .order("id")
        .range(a, b)
    ),
    fetchAllPages((a, b) => (supabase.from("student_keys") as any).select("key, merged_into, hidden, memo").order("key").range(a, b)),
  ]);

  const maxBy = new Map<string, { max: number; n: number }>();
  for (const k of (keysRes.data as any[]) ?? []) {
    const m = maxBy.get(k.exam_id) ?? { max: 0, n: 0 };
    m.max += Number(k.points) || 0;
    m.n += 1;
    maxBy.set(k.exam_id, m);
  }
  const exams = new Map<string, ExamMeta>();
  for (const e of (examsRes.data as any[]) ?? []) {
    const m = maxBy.get(e.id) ?? { max: 0, n: 0 };
    exams.set(e.id, { id: e.id, code: e.code, name: e.name, max: m.max, n: m.n });
  }

  const subs: SubRow[] = ((subsRes.data as any[]) ?? []).map((r) => {
    const gr = Array.isArray(r.grading_results) ? r.grading_results[0] : r.grading_results;
    return {
      id: r.id,
      exam_id: r.exam_id,
      class_label: r.class_label,
      student_name: r.student_name,
      tutor_id: r.tutor_id ?? null,
      submitted_at: r.submitted_at,
      total_score: Number(gr?.total_score ?? 0),
    };
  });

  const keysAvailable = !skRes.error;
  const keyRows: KeyRow[] = keysAvailable
    ? ((skRes.data as any[]) ?? []).map((r) => ({ key: r.key, merged_into: r.merged_into ?? null, hidden: !!r.hidden, memo: r.memo ?? "" }))
    : [];

  // 과외 반 학생은 "과외 (선생님 이름)"으로 보여 준다
  const tutorIds = Array.from(new Set(subs.map((s) => s.tutor_id).filter((x): x is string => !!x)));
  const tutorLabel = new Map<string, string>();
  if (tutorIds.length) {
    const { data } = await fetchAllIn(tutorIds, (ids, a, b) =>
      supabase.from("profiles").select("id, email, display_name, cohort, department").in("id", ids).order("id").range(a, b)
    );
    for (const p of (data as any[]) ?? []) tutorLabel.set(p.id, personLabel(p) || "과외선생님");
  }

  return { entries: groupStudents(subs, exams, keyRows), exams, subs, keyRows, keysAvailable, tutorLabel };
}

export type StudentDetail = {
  entry: StudentListEntry;
  analysis: Analysis;
  memo: string;
  /** 합쳐진 자동 묶음(대표 자신 포함) — 풀기 버튼용 */
  members: string[];
};

export async function loadStudentDetail(supabase: Client, index: StudentIndex, key: string): Promise<StudentDetail | null> {
  const entry = index.entries.find((e) => e.key === key);
  if (!entry) return null;
  const resolve = makeResolver(index.keyRows);
  const mine = index.subs.filter((s) => resolve(autoKey(s)) === key);
  const examIds = Array.from(new Set(mine.map((s) => s.exam_id)));

  const [grRes, akRes, ieRes] = await Promise.all([
    fetchAllIn(
      mine.map((s) => s.id),
      (ids, a, b) => supabase.from("grading_results").select("id, submission_id, per_item").in("submission_id", ids).order("id").range(a, b)
    ),
    fetchAllIn(examIds, (ids, a, b) =>
      supabase.from("answer_key").select("id, exam_id, item_label, sort_order, points, type, correct_answers").in("exam_id", ids).order("id").range(a, b)
    ),
    fetchAllIn(examIds, (ids, a, b) =>
      supabase
        .from("item_explanations")
        .select("id, exam_id, item_label, area, unit, difficulty, problem_statement, answer_display, solution")
        .in("exam_id", ids)
        .order("id")
        .range(a, b)
    ),
  ]);
  const perBySub = new Map(((grRes.data as any[]) ?? []).map((g) => [g.submission_id, (g.per_item ?? []) as any[]]));
  for (const s of mine) s.per_item = perBySub.get(s.id) ?? [];

  const expl = new Map(((ieRes.data as any[]) ?? []).map((e) => [`${e.exam_id}|${e.item_label}`, e]));
  const items: ItemMeta[] = ((akRes.data as any[]) ?? []).map((k) => {
    const e = expl.get(`${k.exam_id}|${k.item_label}`) ?? {};
    return {
      exam_id: k.exam_id,
      label: String(k.item_label),
      sort_order: Number(k.sort_order) || 0,
      points: Number(k.points) || 0,
      type: k.type === "주관식" ? "주관식" : "객관식",
      area: String(e.area ?? ""),
      unit: String(e.unit ?? ""),
      difficulty: (["하", "중하", "중", "중상", "상"].includes(e.difficulty) ? e.difficulty : "중") as ItemMeta["difficulty"],
      correct_answers: String(k.correct_answers ?? ""),
      problem_statement: String(e.problem_statement ?? ""),
      answer_display: String(e.answer_display ?? ""),
      solution: String(e.solution ?? ""),
    };
  });

  const examSet = new Set(examIds);
  const peers = index.subs.filter((s) => examSet.has(s.exam_id)).map((s) => ({ exam_id: s.exam_id, class_label: s.class_label, total_score: s.total_score }));
  const analysis = analyzeStudent(mine, index.exams, items, peers);
  const memo = index.keyRows.find((r) => r.key === key)?.memo ?? "";
  return { entry, analysis, memo, members: entry.members };
}

/** 화면에 보일 반 이름: 과외 반이면 "과외 (선생님)" */
export function classDisplay(entry: Pick<StudentListEntry, "classLabels" | "tutorId">, tutorLabel: Map<string, string>): string {
  if (entry.tutorId) return `과외 (${tutorLabel.get(entry.tutorId) ?? "과외선생님"})`;
  return entry.classLabels.join(" · ");
}
