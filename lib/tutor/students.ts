import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllIn, fetchAllPages } from "@/lib/supabase/fetchAll";
import { autoKey, encodeKey, normName, type ExamMeta, type ItemMeta, type SubRow } from "@/lib/students/analysis";
import { buildSubmittedExams, type SubmittedExam } from "@/lib/students/submitted";

// 2026-10-03 과외선생님 "내 학생" 탭: 선생님 전용 링크로 들어온 제출(submissions.tutor_id = 본인)만 학생(이름)별로 묶는다.
// 제출 읽기는 과외선생님 세션 그대로(RLS 0017 submissions_select_tutor_own). 정답표·해설은 과외선생님 RLS를 못 지나므로
// 본인 제출이 있는 시험만 서비스롤로 읽고, 정답·풀이는 지금도 구매 중인 시험에서만 보여 준다(구매 취소 시 감춤).

export type TutorStudentRow = {
  id: string; // encodeKey(autoKey) — 주소용
  key: string;
  name: string;
  nExams: number;
  lastAt: string;
  lastExam: string;
  lastRate: number | null;
  avgRate: number | null;
};

type Loaded = { subs: SubRow[]; exams: Map<string, ExamMeta>; purchased: Set<string> };

async function loadBase(tutorId: string, withPerItem: boolean): Promise<Loaded> {
  const supabase = await createClient();
  const sel = withPerItem
    ? "id, exam_id, class_label, student_name, tutor_id, submitted_at, grading_results(total_score, per_item)"
    : "id, exam_id, class_label, student_name, tutor_id, submitted_at, grading_results(total_score)";
  const [subsRes, purRes] = await Promise.all([
    fetchAllPages((a, b) => (supabase.from("submissions") as any).select(sel).eq("tutor_id", tutorId).order("id").range(a, b)),
    (supabase.from("tutor_exam_purchases") as any).select("exam_id").eq("tutor_id", tutorId),
  ]);
  const subs: SubRow[] = ((subsRes.data as any[]) ?? [])
    .filter((r) => r.tutor_id === tutorId)
    .map((r) => {
      const gr = Array.isArray(r.grading_results) ? r.grading_results[0] : r.grading_results;
      return {
        id: r.id,
        exam_id: r.exam_id,
        class_label: r.class_label,
        student_name: r.student_name,
        tutor_id: r.tutor_id,
        submitted_at: r.submitted_at,
        total_score: Number(gr?.total_score ?? 0),
        per_item: withPerItem ? ((gr?.per_item ?? []) as any[]) : undefined,
      };
    });
  const purchased = new Set<string>(((purRes.data as any[]) ?? []).map((p) => String(p.exam_id)));

  const examIds = Array.from(new Set(subs.map((s) => s.exam_id)));
  const exams = new Map<string, ExamMeta>();
  if (examIds.length) {
    const admin = createAdminClient();
    const [exRes, akRes] = await Promise.all([
      fetchAllIn(examIds, (ids, a, b) => admin.from("exams").select("id, code, name").in("id", ids).order("id").range(a, b)),
      fetchAllIn(examIds, (ids, a, b) => admin.from("answer_key").select("id, exam_id, points").in("exam_id", ids).order("id").range(a, b)),
    ]);
    const maxBy = new Map<string, { max: number; n: number }>();
    for (const k of (akRes.data as any[]) ?? []) {
      const m = maxBy.get(k.exam_id) ?? { max: 0, n: 0 };
      m.max += Number(k.points) || 0;
      m.n += 1;
      maxBy.set(k.exam_id, m);
    }
    for (const e of (exRes.data as any[]) ?? []) {
      const m = maxBy.get(e.id) ?? { max: 0, n: 0 };
      exams.set(e.id, { id: e.id, code: e.code, name: e.name, max: m.max, n: m.n });
    }
  }
  return { subs, exams, purchased };
}

const rateOf = (s: SubRow, exams: Map<string, ExamMeta>) => {
  const m = exams.get(s.exam_id)?.max ?? 0;
  return m > 0 ? s.total_score / m : null;
};

export async function loadTutorStudents(tutorId: string): Promise<TutorStudentRow[]> {
  const { subs, exams } = await loadBase(tutorId, false);
  const groups = new Map<string, SubRow[]>();
  for (const s of subs) {
    const k = autoKey(s);
    const l = groups.get(k) ?? [];
    l.push(s);
    groups.set(k, l);
  }
  const rows: TutorStudentRow[] = [];
  groups.forEach((list, key) => {
    const sorted = [...list].sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
    const last = sorted[0];
    const rates = sorted.map((s) => rateOf(s, exams)).filter((x): x is number => x != null);
    rows.push({
      id: encodeKey(key),
      key,
      name: normName(last.student_name),
      nExams: new Set(list.map((s) => s.exam_id)).size,
      lastAt: last.submitted_at,
      lastExam: exams.get(last.exam_id)?.name ?? "",
      lastRate: rateOf(last, exams),
      avgRate: rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null,
    });
  });
  return rows.sort((a, b) => b.lastAt.localeCompare(a.lastAt) || a.name.localeCompare(b.name, "ko"));
}

export type TutorStudentDetail = { name: string; submitted: SubmittedExam[]; purchasedCodes: Set<string> };

/** key는 반드시 "과외:<본인 id>|이름" 이어야 한다(다른 선생님 학생은 못 봄). */
export async function loadTutorStudent(tutorId: string, key: string): Promise<TutorStudentDetail | null> {
  if (!key.startsWith(`과외:${tutorId}|`)) return null;
  const { subs, exams, purchased } = await loadBase(tutorId, true);
  const mine = subs.filter((s) => autoKey(s) === key);
  if (!mine.length) return null;
  const examIds = Array.from(new Set(mine.map((s) => s.exam_id)));
  const admin = createAdminClient();
  const [akRes, ieRes] = await Promise.all([
    fetchAllIn(examIds, (ids, a, b) =>
      admin.from("answer_key").select("id, exam_id, item_label, sort_order, points, type, correct_answers").in("exam_id", ids).order("id").range(a, b)
    ),
    fetchAllIn(examIds, (ids, a, b) =>
      admin
        .from("item_explanations")
        .select("id, exam_id, item_label, unit, difficulty, problem_statement, answer_display, solution")
        .in("exam_id", ids)
        .order("id")
        .range(a, b)
    ),
  ]);
  const expl = new Map(((ieRes.data as any[]) ?? []).map((e) => [`${e.exam_id}|${e.item_label}`, e]));
  const items: ItemMeta[] = ((akRes.data as any[]) ?? []).map((k) => {
    const e = expl.get(`${k.exam_id}|${k.item_label}`) ?? {};
    const own = purchased.has(String(k.exam_id));
    return {
      exam_id: k.exam_id,
      label: String(k.item_label),
      sort_order: Number(k.sort_order) || 0,
      points: Number(k.points) || 0,
      type: k.type === "주관식" ? "주관식" : "객관식",
      area: "",
      unit: String(e.unit ?? ""),
      difficulty: (["하", "중하", "중", "중상", "상"].includes(e.difficulty) ? e.difficulty : "중") as ItemMeta["difficulty"],
      // 구매 중이 아닌 시험은 정답·풀이를 아예 내려보내지 않는다
      correct_answers: own ? String(k.correct_answers ?? "") : "",
      problem_statement: own ? String(e.problem_statement ?? "") : "",
      answer_display: own ? String(e.answer_display ?? "") : "",
      solution: own ? String(e.solution ?? "") : "",
    };
  });
  const submitted = buildSubmittedExams(mine, exams, items, (id) => purchased.has(String(id)));
  const purchasedCodes = new Set(submitted.filter((s) => s.showKey).map((s) => s.code));
  const last = [...mine].sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))[0];
  return { name: normName(last.student_name), submitted, purchasedCodes };
}
