import Link from "next/link";
import { requireTutor } from "@/lib/auth/requireTutor";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import SubmissionForm from "./SubmissionForm";
import ProblemPageImage from "./ProblemPageImage";

// 편향 방지: answer_display/solution/difficulty_reason/exam_error_* 는 절대 select하지 않는다.
// primary 문항도 AI가 만든 초안(정답·풀이)이 낮은 확신/오답이라서 검토 큐에 온 것이므로, 그 초안을
// 보여주면 과외선생님이 그대로 베끼거나 편향될 위험이 있다 — 문제 본문과 메타정보만 보고 처음부터
// 다시 풀게 한다. verify 문항은 원 제출자의 답을 볼 수 없어야 하므로(블라인드 재검증) 당연히 제외.
export default async function ReviewItemPage({
  params,
}: {
  params: { itemId: string };
  searchParams: { kind?: string };
}) {
  await requireTutor();

  // 0037: 과외선생님 세션은 item_explanations를 직접 읽지 못한다(행 전체 — AI 답·앞사람 답까지 — 가 보이던 구멍을 막음).
  // 지금 이 문항을 배정받았는지만 DB 함수로 확인하고, 화면에 필요한 열만 서버가 읽어 보여 준다.
  const supabase = await createClient();
  const { data: access } = (await (supabase.rpc as any)("tutor_item_access", { p_item_explanation_id: params.itemId })) as any;
  const kind: "primary" | "verify" = access === "verify" ? "verify" : "primary";
  const admin = createAdminClient();
  const { data: item } = access
    ? ((await admin
        .from("item_explanations")
        .select("id, exam_id, item_label, area, unit, difficulty, source_page, bbox_x0, bbox_y0, bbox_x1, bbox_y1")
        .eq("id", params.itemId)
        .maybeSingle()) as any)
    : { data: null };

  if (!item) {
    return (
      <div className="card space-y-3 max-w-lg mx-auto text-center">
        <p className="text-sm text-red-600">이 문항에 접근할 수 없습니다. 배정이 만료됐을 수 있습니다.</p>
        <Link href="/tutor/review" className="btn-primary inline-block">
          다음 문항 받기
        </Link>
      </div>
    );
  }

  const [{ data: exam }, { data: keyRow }] = await Promise.all([
    admin.from("exams").select("code, name").eq("id", item.exam_id).maybeSingle() as any,
    // 정답 입력 방식(객관식 ①~⑤ / 주관식)을 정하려고 "유형"만 읽는다 — 정답 값은 읽지 않는다
    admin.from("answer_key").select("type").eq("exam_id", item.exam_id).eq("item_label", item.item_label).maybeSingle() as any,
  ]);

  return (
    <div className="space-y-4">
      <div className="card space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* kind가 verify여도 화면에 표시하지 않는다 — "새 문항과 똑같은 화면"이어야 검증자가
              눈치채지 못하고 자기 실력대로 다시 푼다(블라인드 재검증, 계획 문서 참고). */}
          <h1 className="text-lg font-semibold">
            {exam?.name ?? "시험"} · {item.item_label}번
          </h1>
        </div>
        <p className="text-sm text-slate-500">
          {item.area && `${item.area} · `}
          {item.unit && `${item.unit} · `}
          난이도 {item.difficulty}
          {/* 0028: 난이도별 적립 — 하·중하·중 1P, 중상·상 2P (DB review_points_for_item과 같은 규칙) */}
          <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
            기본 +{item.difficulty === "중상" || item.difficulty === "상" ? 2 : 1}P
          </span>
        </p>
        <div className="border-t border-slate-100 pt-2">
          <ProblemPageImage
            pdfUrl={`/tutor/review/${item.id}/pdf`}
            label={String(item.item_label ?? "")}
            page={item.source_page ?? null}
            bbox={
              item.bbox_x0 != null && item.bbox_y0 != null && item.bbox_x1 != null && item.bbox_y1 != null
                ? { x0: item.bbox_x0, y0: item.bbox_y0, x1: item.bbox_x1, y1: item.bbox_y1 }
                : null
            }
          />
        </div>
        <p className="text-xs text-slate-400">
          문제가 여러 쪽에 걸쳐 있으면 이미지 아래 &quot;이전 쪽 / 다음 쪽&quot; 버튼으로 앞뒤 쪽을
          확인해 주세요.
        </p>
      </div>

      <SubmissionForm itemExplanationId={item.id} kind={kind} answerType={keyRow?.type === "객관식" ? "객관식" : "주관식"} />
    </div>
  );
}
