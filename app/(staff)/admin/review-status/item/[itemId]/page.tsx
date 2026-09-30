import Link from "next/link";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { toKeyAnswer } from "@/lib/review/confirm";
import ProblemPageImage from "@/app/(tutor)/tutor/review/[itemId]/ProblemPageImage";
import AdminSolveForm from "./AdminSolveForm";
import AdminPhotos from "./AdminPhotos";
import RedigitizeBox from "./RedigitizeBox";
import { findDigitizedItem } from "@/lib/digitize/itemEdit";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// 2026-09-29 원장님 요청: 검토현황에서 관리자가 문제(원본 시험지의 그 문항 부분)를 보면서 정답·해설을 직접 등록·확정.
// 과외선생님 화면과 같은 문항 잘라 보기(ProblemPageImage)를 쓰되, PDF는 관리자 전용 원본 경로로 읽는다.
export default async function AdminReviewItemPage({ params }: { params: { itemId: string } }) {
  await requireRole("admin");
  const supabase = await createClient();

  const { data: it } = (await supabase
    .from("item_explanations")
    .select(
      "id, exam_id, item_label, area, unit, difficulty, problem_statement, answer_display, solution, ai_answer_display, ai_solution, source_page, bbox_x0, bbox_y0, bbox_x1, bbox_y1, review_confirmed, review_confirm_source, claimed_by, claim_expires_at"
    )
    .eq("id", params.itemId)
    .maybeSingle()) as any;
  if (!it) {
    return (
      <div className="card space-y-2">
        <p className="text-sm text-red-600">문항을 찾을 수 없습니다.</p>
        <Link href="/admin/review-status" className="link-accent text-sm">
          검토현황으로
        </Link>
      </div>
    );
  }

  const [{ data: exam }, { data: key }, { data: reviews }, { data: siblings }, { data: keys }]: any[] = await Promise.all([
    supabase.from("exams").select("id, code, name, status").eq("id", it.exam_id).maybeSingle(),
    supabase.from("answer_key").select("correct_answers, type, points").eq("exam_id", it.exam_id).eq("item_label", it.item_label).maybeSingle(),
    supabase
      .from("tutor_item_reviews")
      .select("id, tutor_id, kind, answer_display, solution, image_path, created_at")
      .eq("item_explanation_id", it.id)
      .order("created_at", { ascending: true }),
    supabase.from("item_explanations").select("id, item_label, review_confirmed").eq("exam_id", it.exam_id),
    supabase.from("answer_key").select("item_label, sort_order").eq("exam_id", it.exam_id),
  ]);
  // 2026-09-30: 디지털화된 시험이면 이 문항의 디지털 시험지 글을 여기서 바로 고친다(RedigitizeBox)
  const [{ data: dgPages }, { data: pdfMeta }]: any[] = await Promise.all([
    supabase.from("digitized_pages").select("page_no, data").eq("exam_id", it.exam_id),
    supabase.from("exam_pdf_meta").select("replaced_with_digitized").eq("exam_id", it.exam_id).maybeSingle(),
  ]);
  const dgAt = dgPages?.length ? findDigitizedItem(dgPages as any[], String(it.item_label ?? "")) : null;
  // 관리자가 올린 풀이 사진(tutor-review-photos 버킷 admin/<문항 id>/)
  const { data: photoList } = await createAdminClient()
    .storage.from("tutor-review-photos")
    .list(`admin/${it.id}`, { limit: 50, sortBy: { column: "name", order: "asc" } });
  const photoNames = ((photoList as any[]) ?? [])
    .map((f) => String(f.name))
    .filter((n) => /^[0-9]+\.[a-z0-9]{1,5}$/i.test(n));
  const tutorIds = Array.from(
    new Set([...((reviews as any[]) ?? []).map((r) => r.tutor_id), ...(it.claimed_by ? [it.claimed_by] : [])])
  );
  const { data: profs } = tutorIds.length
    ? ((await supabase.from("profiles").select("id, email, display_name, cohort").in("id", tutorIds)) as any)
    : { data: [] };
  const who = new Map(
    ((profs as any[]) ?? []).map((p) => [p.id, [p.cohort, p.display_name].filter(Boolean).join(" ") || p.email])
  );

  // 같은 시험의 문항 순서(정답표 순서)와 다음 미확정 문항
  const order = new Map(((keys as any[]) ?? []).map((k) => [k.item_label, typeof k.sort_order === "number" ? k.sort_order : 9999]));
  const sorted = ((siblings as any[]) ?? []).sort(
    (a, b) =>
      (order.get(a.item_label) ?? 9999) - (order.get(b.item_label) ?? 9999) ||
      String(a.item_label).localeCompare(String(b.item_label), "ko", { numeric: true })
  );
  const idx = sorted.findIndex((s) => s.id === it.id);
  const nextOpen = [...sorted.slice(idx + 1), ...sorted.slice(0, Math.max(0, idx))].find((s) => !s.review_confirmed && s.id !== it.id);
  const nextHref = nextOpen ? `/admin/review-status/item/${nextOpen.id}` : null;

  const primary = ((reviews as any[]) ?? []).filter((r) => r.kind === "primary").pop();
  const initialKey = primary && key ? toKeyAnswer(key.type, primary.answer_display) : key?.correct_answers ?? "";
  const claimed = !!it.claimed_by && !!it.claim_expires_at && new Date(it.claim_expires_at).getTime() > Date.now();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/admin/review-status" className="text-sm link-accent">
          ← 검토현황
        </Link>
        <div className="flex flex-wrap gap-1 text-xs">
          {sorted.map((s) => (
            <Link
              key={s.id}
              href={`/admin/review-status/item/${s.id}`}
              className={
                "badge " +
                (s.id === it.id ? "bg-slate-800 text-white" : s.review_confirmed ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-700")
              }
              title={s.review_confirmed ? "확정됨" : "미확정"}
            >
              {s.item_label}
            </Link>
          ))}
        </div>
      </div>

      <div className="card space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold">
            {exam?.name ?? "시험"} · {it.item_label}번
          </h1>
          {it.review_confirmed ? (
            <span className="badge bg-emerald-100 text-emerald-700">확정됨</span>
          ) : (
            <span className="badge bg-amber-100 text-amber-700">미확정</span>
          )}
          {claimed && !it.review_confirmed && (
            <span className="badge bg-sky-100 text-sky-700">
              {who.get(it.claimed_by) ?? "과외선생님"} 선생님이 풀고 있음 — 확정하면 그 배정은 끝납니다
            </span>
          )}
        </div>
        <p className="text-sm text-slate-500">
          {[it.area, it.unit, it.difficulty && `난이도 ${it.difficulty}`, key?.type, key?.points != null && `${key.points}점`]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {exam?.code ? (
          <ProblemPageImage
            pdfUrl={`/exams/${encodeURIComponent(exam.code)}/original-pdf`}
            label={String(it.item_label ?? "")}
            page={it.source_page ?? null}
            bbox={
              it.bbox_x0 != null && it.bbox_y0 != null && it.bbox_x1 != null && it.bbox_y1 != null
                ? { x0: it.bbox_x0, y0: it.bbox_y0, x1: it.bbox_x1, y1: it.bbox_y1 }
                : null
            }
          />
        ) : null}
        {it.problem_statement && (
          <details className="text-sm">
            <summary className="cursor-pointer text-slate-500">AI가 읽은 문제 요약</summary>
            <p className="mt-1 whitespace-pre-wrap text-slate-700">{it.problem_statement}</p>
          </details>
        )}
      </div>

      {dgAt && exam?.code && (
        <RedigitizeBox
          code={exam.code}
          examId={it.exam_id}
          examName={exam.name ?? "시험"}
          pageNo={dgAt.pageNo}
          itemIndex={dgAt.itemIndex}
          applied={!!pdfMeta?.replaced_with_digitized}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-2 text-sm">
          <h2 className="font-medium">지금 정답표·해설</h2>
          <p>
            정답표: <b>{key?.correct_answers ?? <span className="text-red-600">없음</span>}</b>
          </p>
          <p>정답 표시: {it.answer_display || "—"}</p>
          <details>
            <summary className="cursor-pointer text-slate-500">풀이 보기</summary>
            <p className="mt-1 whitespace-pre-wrap text-slate-700">{it.solution || "—"}</p>
          </details>
          {(it.ai_answer_display != null || it.ai_solution != null) && (
            <details>
              <summary className="cursor-pointer text-slate-500">AI 원본 정답·풀이</summary>
              <p className="mt-1">정답: {it.ai_answer_display || "—"}</p>
              <p className="mt-1 whitespace-pre-wrap text-slate-700">{it.ai_solution || "—"}</p>
            </details>
          )}
        </div>
        <div className="card space-y-2 text-sm">
          <h2 className="font-medium">과외선생님 제출</h2>
          {((reviews as any[]) ?? []).length === 0 ? (
            <p className="text-slate-400">아직 없음</p>
          ) : (
            ((reviews as any[]) ?? []).map((r) => (
              <div key={r.id} className="border-t border-slate-100 pt-2 first:border-0 first:pt-0">
                <p>
                  <span className="badge bg-slate-100 text-slate-600 mr-1">{r.kind === "verify" ? "사후검증" : "검토"}</span>
                  <b>{r.answer_display}</b> <span className="text-xs text-slate-500">{who.get(r.tutor_id) ?? "과외선생님"}</span>
                  {r.image_path && (
                    <>
                      {" · "}
                      <a href={`/admin/tutor-disputes/photo/${r.id}`} target="_blank" rel="noreferrer" className="link-accent text-xs">
                        풀이 사진
                      </a>
                    </>
                  )}
                </p>
                {r.solution && <p className="mt-1 whitespace-pre-wrap text-slate-700">{r.solution}</p>}
              </div>
            ))
          )}
        </div>
      </div>

      <AdminPhotos itemId={it.id} names={photoNames} />

      <AdminSolveForm
        itemId={it.id}
        initialKey={initialKey}
        initialDisplay={primary?.answer_display ?? it.answer_display ?? ""}
        initialSolution={primary?.solution ?? it.solution ?? ""}
        nextHref={nextHref}
        answerType={key?.type === "객관식" ? "객관식" : "주관식"}
      />
    </div>
  );
}
