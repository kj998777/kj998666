import "server-only";
import { fetchAllIn, fetchAllPages } from "@/lib/supabase/fetchAll";
import type { BankItem } from "@/lib/bank/search";
import { findDigitizedItem } from "@/lib/digitize/itemEdit";

// 문항 은행 읽기(직원 세션 — RLS가 직원만 허용). 문항 수가 수천 개여도 필요한 칸만 읽어 서버에서 거른다.
type Client = any;

export async function loadBankItems(supabase: Client): Promise<BankItem[]> {
  const [ex, ie, ak] = await Promise.all([
    fetchAllPages((a, b) =>
      supabase.from("exams").select("id, code, name, status, school_level, folder_grade, folder_year, is_jeju").order("id").range(a, b)
    ),
    fetchAllPages((a, b) =>
      supabase
        .from("item_explanations")
        .select("id, exam_id, item_label, area, unit, difficulty, problem_statement, answer_display, review_confirmed, source_page, bbox_x0")
        .order("id")
        .range(a, b)
    ),
    fetchAllPages((a, b) => supabase.from("answer_key").select("id, exam_id, item_label, correct_answers, type, points, sort_order").order("id").range(a, b)),
  ]);
  const exams = new Map(((ex.data as any[]) ?? []).map((e) => [e.id, e]));
  const keys = new Map(((ak.data as any[]) ?? []).map((k) => [`${k.exam_id}|${k.item_label}`, k]));
  const out: BankItem[] = [];
  for (const r of (ie.data as any[]) ?? []) {
    const e = exams.get(r.exam_id);
    if (!e) continue;
    const k = keys.get(`${r.exam_id}|${r.item_label}`);
    out.push({
      id: r.id,
      examId: r.exam_id,
      examCode: e.code,
      examName: e.name,
      examStatus: e.status,
      schoolLevel: e.school_level ?? null,
      grade: e.folder_grade ?? null,
      year: e.folder_year ?? null,
      isJeju: !!e.is_jeju,
      label: String(r.item_label),
      sortOrder: Number(k?.sort_order ?? 0),
      area: String(r.area ?? ""),
      unit: String(r.unit ?? ""),
      difficulty: String(r.difficulty ?? "중"),
      type: k?.type === "객관식" || k?.type === "주관식" ? k.type : "",
      statement: String(r.problem_statement ?? ""),
      answerDisplay: String(r.answer_display ?? ""),
      correctAnswers: String(k?.correct_answers ?? ""),
      points: Number(k?.points ?? 0),
      confirmed: !!r.review_confirmed || e.status !== "검수대기",
      hasLocation: r.source_page != null && r.bbox_x0 != null,
    });
  }
  return out;
}

export type BankDetail = BankItem & {
  solution: string;
  sourcePage: number | null;
  bbox: { x0: number; y0: number; x1: number; y1: number } | null;
  /** 디지털화한 시험이면 옮겨 적은 문제 글(원래 자리를 못 찾을 때 시험지에 대신 넣음). figures = 그림 개수 */
  dg?: { stem: string; box_title: string; box_lines: string[]; choices: string[]; figures: number } | null;
};

/** 담은 문항의 자세한 내용(풀이·자리) — 시험지·해설지를 만들 때 */
export async function loadBankDetails(supabase: Client, ids: string[]): Promise<BankDetail[]> {
  const uniq = Array.from(new Set(ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)))).slice(0, 100);
  if (!uniq.length) return [];
  const { data: rows } = await fetchAllIn(uniq, (chunk, a, b) =>
    supabase
      .from("item_explanations")
      .select(
        "id, exam_id, item_label, area, unit, difficulty, problem_statement, answer_display, solution, review_confirmed, source_page, bbox_x0, bbox_y0, bbox_x1, bbox_y1"
      )
      .in("id", chunk)
      .order("id")
      .range(a, b)
  );
  const examIds = Array.from(new Set(((rows as any[]) ?? []).map((r) => r.exam_id)));
  const [{ data: ex }, { data: ak }] = await Promise.all([
    fetchAllIn(examIds, (chunk, a, b) =>
      supabase.from("exams").select("id, code, name, status, school_level, folder_grade, folder_year, is_jeju").in("id", chunk).order("id").range(a, b)
    ),
    fetchAllIn(examIds, (chunk, a, b) =>
      supabase.from("answer_key").select("id, exam_id, item_label, correct_answers, type, points, sort_order").in("exam_id", chunk).order("id").range(a, b)
    ),
  ]);
  const exams = new Map(((ex as any[]) ?? []).map((e) => [e.id, e]));
  const keys = new Map(((ak as any[]) ?? []).map((k) => [`${k.exam_id}|${k.item_label}`, k]));
  const byId = new Map<string, BankDetail>();
  for (const r of (rows as any[]) ?? []) {
    const e = exams.get(r.exam_id);
    if (!e) continue;
    const k = keys.get(`${r.exam_id}|${r.item_label}`);
    const hasBox = [r.bbox_x0, r.bbox_y0, r.bbox_x1, r.bbox_y1].every((v) => typeof v === "number");
    byId.set(r.id, {
      id: r.id,
      examId: r.exam_id,
      examCode: e.code,
      examName: e.name,
      examStatus: e.status,
      schoolLevel: e.school_level ?? null,
      grade: e.folder_grade ?? null,
      year: e.folder_year ?? null,
      isJeju: !!e.is_jeju,
      label: String(r.item_label),
      sortOrder: Number(k?.sort_order ?? 0),
      area: String(r.area ?? ""),
      unit: String(r.unit ?? ""),
      difficulty: String(r.difficulty ?? "중"),
      type: k?.type === "객관식" || k?.type === "주관식" ? k.type : "",
      statement: String(r.problem_statement ?? ""),
      answerDisplay: String(r.answer_display ?? ""),
      correctAnswers: String(k?.correct_answers ?? ""),
      points: Number(k?.points ?? 0),
      confirmed: !!r.review_confirmed || e.status !== "검수대기",
      hasLocation: r.source_page != null && hasBox,
      solution: String(r.solution ?? ""),
      sourcePage: r.source_page ?? null,
      bbox: hasBox ? { x0: r.bbox_x0, y0: r.bbox_y0, x1: r.bbox_x1, y1: r.bbox_y1 } : null,
    });
  }
  // 담은 순서 그대로
  return uniq.map((id) => byId.get(id)).filter((x): x is BankDetail => !!x);
}

/**
 * 2026-09-30: 디지털화한 시험의 문항에 옮겨 적은 문제 글을 붙인다(시험지에서 원래 자리를 못 찾을 때 대신 쓰려고).
 * digitized_pages는 관리자만 읽을 수 있어 서비스롤 클라이언트로 부른다 — 부르는 쪽이 권한을 먼저 확인할 것.
 */
export async function attachDigitized(admin: Client, items: BankDetail[]): Promise<BankDetail[]> {
  const examIds = Array.from(new Set(items.map((x) => x.examId)));
  if (!examIds.length) return items;
  const { data } = await fetchAllIn(examIds, (chunk, a, b) =>
    admin.from("digitized_pages").select("exam_id, page_no, data").in("exam_id", chunk).order("id").range(a, b), 40
  );
  const byExam = new Map<string, { page_no: number; data: any }[]>();
  for (const p of (data as any[]) ?? []) {
    const arr = byExam.get(p.exam_id) ?? [];
    arr.push({ page_no: p.page_no, data: p.data });
    byExam.set(p.exam_id, arr);
  }
  return items.map((it) => {
    const pages = byExam.get(it.examId);
    const at = pages ? findDigitizedItem(pages, it.label) : null;
    const d = at ? pages!.find((p) => p.page_no === at.pageNo)?.data?.items?.[at.itemIndex] : null;
    if (!d) return it;
    return {
      ...it,
      dg: {
        stem: String(d.stem ?? ""),
        box_title: String(d.box_title ?? ""),
        box_lines: Array.isArray(d.box_lines) ? d.box_lines.map(String) : [],
        choices: Array.isArray(d.choices) ? d.choices.map(String) : [],
        figures: Array.isArray(d.figures) ? d.figures.length : 0,
      },
    };
  });
}
