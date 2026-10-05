import "server-only";
import { fetchAllIn, fetchAllPages } from "@/lib/supabase/fetchAll";
import { subjectOfExam } from "@/lib/similar/logicTypes";

// 논리 유형이 비어 있는 문항 모으기(관리자 "유형 분류" 탭, 2026-10-05). 시험별로 묶고, 시험 이름으로 과목을 짐작한다.

type Client = any;

export type UnclassifiedItem = { id: string; label: string; unit: string; difficulty: string; statement: string };
export type UnclassifiedExam = {
  examId: string;
  code: string;
  name: string;
  status: string;
  /** 시험 이름으로 짐작한 과목(c2/c1/m2/j3) — 모르면 null */
  subject: string | null;
  /** 이 시험에서 이미 유형이 정해진 문항들의 과목(짐작이 없을 때 참고) */
  usedSubject: string | null;
  items: UnclassifiedItem[];
};

export async function loadUnclassified(admin: Client): Promise<UnclassifiedExam[]> {
  const { data: rows } = await fetchAllPages((a: number, b: number) =>
    admin
      .from("item_explanations")
      .select("id, exam_id, item_label, unit, difficulty, problem_statement")
      .is("logic_type", null)
      .order("id")
      .range(a, b)
  );
  const list = (rows as any[]) ?? [];
  if (!list.length) return [];
  const examIds = Array.from(new Set(list.map((r) => r.exam_id as string)));
  const [{ data: exs }, { data: keys }, { data: done }] = await Promise.all([
    fetchAllIn(examIds, (ids, a, b) => admin.from("exams").select("id, code, name, status, folder_grade").in("id", ids).order("id").range(a, b)),
    fetchAllIn(examIds, (ids, a, b) => admin.from("answer_key").select("id, exam_id, item_label, sort_order").in("exam_id", ids).order("id").range(a, b)),
    fetchAllIn(examIds, (ids, a, b) =>
      admin.from("item_explanations").select("id, exam_id, logic_type").in("exam_id", ids).not("logic_type", "is", null).order("id").range(a, b)
    ),
  ]);
  const sortOf = new Map(((keys as any[]) ?? []).map((k) => [`${k.exam_id}|${k.item_label}`, Number(k.sort_order) || 0]));
  const usedBy = new Map<string, string>();
  for (const d of (done as any[]) ?? []) if (!usedBy.has(d.exam_id)) usedBy.set(d.exam_id, String(d.logic_type).split(".")[0]);
  const out: UnclassifiedExam[] = [];
  for (const e of (exs as any[]) ?? []) {
    const items = list
      .filter((r) => r.exam_id === e.id)
      .sort((a, b) => (sortOf.get(`${e.id}|${a.item_label}`) ?? 0) - (sortOf.get(`${e.id}|${b.item_label}`) ?? 0))
      .map((r) => ({
        id: r.id,
        label: String(r.item_label),
        unit: String(r.unit ?? ""),
        difficulty: String(r.difficulty ?? ""),
        statement: String(r.problem_statement ?? "").replace(/\s+/g, " ").slice(0, 160),
      }));
    out.push({
      examId: e.id,
      code: e.code,
      name: e.name,
      status: e.status,
      subject: subjectOfExam(e.name, e.folder_grade ?? null),
      usedSubject: usedBy.get(e.id) ?? null,
      items,
    });
  }
  return out.sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name, "ko"));
}
