import "server-only";
import { fetchAllIn, fetchAllPages } from "@/lib/supabase/fetchAll";
import { findDigitizedItem } from "@/lib/digitize/itemEdit";
import { inspectItem, SUSPECT_MIN, textHash, type SuspectReason } from "@/lib/digitize/suspect";

// 디지털화 의심 문항 모으기(2026-09-30). 계산은 lib/digitize/suspect.ts. 관리자 세션(RLS: digitized_pages는 관리자만)으로 부른다.

type Client = any;

export type SuspectRow = {
  examId: string;
  code: string;
  examName: string;
  pageNo: number;
  itemIndex: number;
  label: string;
  score: number;
  reasons: SuspectReason[];
  edited: string | null;
  itemId: string | null; // 검토 문항 화면으로 갈 item_explanations id(번호가 안 맞으면 null)
};

export async function loadDigitizeSuspects(
  client: Client,
  opts: { examIds?: string[]; includeOk?: boolean } = {}
): Promise<{ rows: SuspectRow[]; examsChecked: number; itemsChecked: number }> {
  // 디지털화가 끝난 시험
  let examIds = opts.examIds;
  if (!examIds) {
    const { data: jobs } = await fetchAllPages((a, b) => client.from("digitize_jobs").select("exam_id").eq("stage", "dg_done").order("exam_id").range(a, b));
    examIds = ((jobs as any[]) ?? []).map((j) => j.exam_id);
  }
  if (!examIds.length) return { rows: [], examsChecked: 0, itemsChecked: 0 };

  const [pagesRes, examsRes, ieRes, keyRes] = await Promise.all([
    fetchAllIn(examIds, (ids, a, b) => client.from("digitized_pages").select("exam_id, page_no, data").in("exam_id", ids).order("id").range(a, b), 40),
    fetchAllIn(examIds, (ids, a, b) => client.from("exams").select("id, code, name").in("id", ids).order("id").range(a, b)),
    fetchAllIn(examIds, (ids, a, b) =>
      client.from("item_explanations").select("id, exam_id, item_label, problem_statement, solution, answer_display").in("exam_id", ids).order("id").range(a, b)
    ),
    fetchAllIn(examIds, (ids, a, b) => client.from("answer_key").select("exam_id, item_label, type").in("exam_id", ids).order("id").range(a, b)),
  ]);
  const examOf = new Map(((examsRes.data as any[]) ?? []).map((e) => [e.id, e]));
  const typeOf = new Map(((keyRes.data as any[]) ?? []).map((k) => [`${k.exam_id}|${k.item_label}`, k.type]));
  const pagesByExam = new Map<string, { page_no: number; data: any }[]>();
  for (const p of (pagesRes.data as any[]) ?? []) {
    const arr = pagesByExam.get(p.exam_id) ?? [];
    arr.push({ page_no: p.page_no, data: p.data });
    pagesByExam.set(p.exam_id, arr);
  }
  // 채점 문항 → 디지털화 문항 자리(소문항 27-(1)·27-(2)는 같은 자리로 모인다)
  const iesAt = new Map<string, any[]>();
  for (const ie of (ieRes.data as any[]) ?? []) {
    const pages = pagesByExam.get(ie.exam_id);
    if (!pages) continue;
    const at = findDigitizedItem(pages, String(ie.item_label ?? ""));
    if (!at) continue;
    const k = `${ie.exam_id}|${at.pageNo}|${at.itemIndex}`;
    const arr = iesAt.get(k) ?? [];
    arr.push(ie);
    iesAt.set(k, arr);
  }

  const rows: SuspectRow[] = [];
  let itemsChecked = 0;
  for (const [examId, pages] of pagesByExam) {
    const ex = examOf.get(examId);
    if (!ex) continue;
    for (const p of pages) {
      const items = Array.isArray(p.data?.items) ? p.data.items : [];
      items.forEach((it: any, i: number) => {
        if (it?.type !== "question") return;
        itemsChecked++;
        if (!opts.includeOk && it.ok_hash && it.ok_hash === textHash(it)) return;
        const ies = iesAt.get(`${examId}|${p.page_no}|${i}`) ?? [];
        const single = ies.length === 1 ? ies[0] : null;
        const r = inspectItem({
          item: it,
          summary: ies.map((x) => x.problem_statement ?? ""),
          solution: ies.map((x) => x.solution ?? ""),
          mcAnswerDisplay: single && typeOf.get(`${examId}|${single.item_label}`) === "객관식" ? single.answer_display : null,
        });
        if (r.score < SUSPECT_MIN) return;
        rows.push({
          examId,
          code: ex.code,
          examName: ex.name,
          pageNo: p.page_no,
          itemIndex: i,
          label: String(it.label ?? "?"),
          score: r.score,
          reasons: r.reasons,
          edited: it.edited ?? null,
          itemId: ies[0]?.id ?? null,
        });
      });
    }
  }
  rows.sort((a, b) => b.score - a.score || a.examName.localeCompare(b.examName, "ko") || a.pageNo - b.pageNo || a.itemIndex - b.itemIndex);
  return { rows, examsChecked: pagesByExam.size, itemsChecked };
}
