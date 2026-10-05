import Link from "next/link";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import ResolveButton from "./ResolveButton";
import AdoptReviewButton from "../review-status/AdoptReviewButton";

// "선반영 후 사후 샘플 검증" 모델의 안전망. kind='primary' 이면서 verified=true(=검증이 끝났음)인데
// resolved=false(=검증 결과가 불일치였음 — resolve_tutor_verification이 일치일 때만 resolved=true로
// 바꾼다)인 건들을 모아 보여준다. verified=false인 건(아직 검증 대상으로 배정만 되고 검증 전)은
// 여기 나오지 않는다 — 아직 "불일치가 확인된" 건이 아니기 때문.
export default async function TutorDisputesPage() {
  await requireRole("admin");
  const supabase = await createClient();

  const { data: primariesRaw } = (await supabase
    .from("tutor_item_reviews")
    .select("id, item_explanation_id, exam_id, item_label, tutor_id, answer_display, solution, image_path, created_at")
    .eq("kind", "primary")
    .eq("verified", true)
    .eq("resolved", false)
    .order("created_at", { ascending: false })) as any;

  const primaries = (primariesRaw as any[]) ?? [];

  if (primaries.length === 0) {
    return (
      <div className="card">
        <h1 className="text-lg font-semibold mb-2">과외선생님 검토 불일치</h1>
        <p className="text-sm text-slate-500">지금 확인이 필요한 불일치 건이 없습니다.</p>
      </div>
    );
  }

  const primaryIds = primaries.map((p) => p.id);
  const examIds = [...new Set(primaries.map((p) => p.exam_id))];

  const [{ data: verifiesRaw }, { data: examsRaw }] = await Promise.all([
    supabase
      .from("tutor_item_reviews")
      .select("id, matches_primary_review_id, tutor_id, answer_display, solution, image_path, is_match, created_at")
      .eq("kind", "verify")
      .in("matches_primary_review_id", primaryIds),
    supabase.from("exams").select("id, code, name").in("id", examIds),
  ]);

  const verifies = (verifiesRaw as any[]) ?? [];
  const verifyByPrimary = new Map(verifies.map((v) => [v.matches_primary_review_id, v]));
  const examById = new Map(((examsRaw as any[]) ?? []).map((e) => [e.id, e]));

  const allTutorIds = [...new Set([...primaries.map((p) => p.tutor_id), ...verifies.map((v) => v.tutor_id)])];
  const { data: profilesRaw } = (await supabase.from("profiles").select("id, email").in("id", allTutorIds)) as any;
  const emailById = new Map(((profilesRaw as any[]) ?? []).map((p) => [p.id, p.email]));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">과외선생님 검토 불일치</h1>
        <p className="text-sm text-slate-500">
          사후 샘플 검증에서 최초 제출과 다른 답이 나온 문항입니다. 맞는 쪽의 <b>이 답·풀이로 확정</b>을 누르면
          정답표·해설이 그 선생님 것으로 바뀌고 확정됩니다(정답이 바뀌면 다시 채점, 이 목록에서도 빠짐). 직접 고쳤다면
          &quot;확인함&quot;만 눌러 주세요.
        </p>
      </div>

      {primaries.map((p) => {
        const v = verifyByPrimary.get(p.id);
        const exam = examById.get(p.exam_id);
        return (
          <div key={p.id} className="card space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-medium">
                {exam?.name ?? "시험"} · {p.item_label}번
              </h2>
              <Link href={`/admin/review-status/item/${p.item_explanation_id}`} className="text-sm link-accent whitespace-nowrap">
                문제 보며 직접 고치기 →
              </Link>
            </div>
            <div className="grid gap-3 md:grid-cols-2 text-sm">
              <div className="border border-slate-200 rounded px-3 py-2">
                <p className="text-slate-500 mb-1">최초 제출 — {emailById.get(p.tutor_id) ?? p.tutor_id}</p>
                <p>
                  <span className="font-medium">정답:</span> {p.answer_display}
                </p>
                {p.solution && <p className="whitespace-pre-wrap mt-1">{p.solution}</p>}
                {p.image_path && (
                  <a
                    href={`/admin/tutor-disputes/photo/${p.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm link-accent inline-block mt-1"
                  >
                    첨부 사진 보기 →
                  </a>
                )}
                <div className="mt-2">
                  <AdoptReviewButton reviewId={p.id} label="최초 제출 답·풀이로 확정" />
                </div>
              </div>
              <div className="border border-slate-200 rounded px-3 py-2">
                <p className="text-slate-500 mb-1">
                  사후 검증 — {v ? emailById.get(v.tutor_id) ?? v.tutor_id : "?"}
                </p>
                <p>
                  <span className="font-medium">정답:</span> {v?.answer_display ?? "-"}
                </p>
                {v?.solution && <p className="whitespace-pre-wrap mt-1">{v.solution}</p>}
                {v?.image_path && (
                  <a
                    href={`/admin/tutor-disputes/photo/${v.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm link-accent inline-block mt-1"
                  >
                    첨부 사진 보기 →
                  </a>
                )}
                {v && (
                  <div className="mt-2">
                    <AdoptReviewButton reviewId={v.id} label="사후 검증 답·풀이로 확정" />
                  </div>
                )}
              </div>
            </div>
            <ResolveButton primaryReviewId={p.id} />
          </div>
        );
      })}
    </div>
  );
}
