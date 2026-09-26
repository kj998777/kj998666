import Link from "next/link";
import { requireTutor } from "@/lib/auth/requireTutor";
import { createClient } from "@/lib/supabase/server";
import SubmissionForm from "./SubmissionForm";

// 편향 방지: answer_display/solution/difficulty_reason/exam_error_* 는 절대 select하지 않는다.
// primary 문항도 AI가 만든 초안(정답·풀이)이 낮은 확신/오답이라서 검토 큐에 온 것이므로, 그 초안을
// 보여주면 과외선생님이 그대로 베끼거나 편향될 위험이 있다 — 문제 본문과 메타정보만 보고 처음부터
// 다시 풀게 한다. verify 문항은 원 제출자의 답을 볼 수 없어야 하므로(블라인드 재검증) 당연히 제외.
export default async function ReviewItemPage({
  params,
  searchParams,
}: {
  params: { itemId: string };
  searchParams: { kind?: string };
}) {
  await requireTutor();
  const kind: "primary" | "verify" = searchParams.kind === "verify" ? "verify" : "primary";

  const supabase = await createClient();
  const { data: item } = (await supabase
    .from("item_explanations")
    .select("id, exam_id, item_label, area, unit, difficulty, problem_statement")
    .eq("id", params.itemId)
    .maybeSingle()) as any;

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

  const { data: exam } = (await supabase
    .from("exams")
    .select("code, name")
    .eq("id", item.exam_id)
    .maybeSingle()) as any;

  return (
    <div className="space-y-4">
      <div className="card space-y-2">
        <div className="flex items-center justify-between gap-3">
          {/* kind가 verify여도 화면에 표시하지 않는다 — "새 문항과 똑같은 화면"이어야 검증자가
              눈치채지 못하고 자기 실력대로 다시 푼다(블라인드 재검증, 계획 문서 참고). */}
          <h1 className="text-lg font-semibold">
            {exam?.name ?? "시험"} · {item.item_label}번
          </h1>
          <a
            href={`/tutor/review/${item.id}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="btn-secondary whitespace-nowrap"
          >
            원본 문제지 PDF 보기
          </a>
        </div>
        <p className="text-sm text-slate-500">
          {item.area && `${item.area} · `}
          {item.unit && `${item.unit} · `}
          난이도 {item.difficulty}
        </p>
        {item.problem_statement && (
          <p className="whitespace-pre-wrap text-sm text-slate-700 border-t border-slate-100 pt-2">
            {item.problem_statement}
          </p>
        )}
        <p className="text-xs text-slate-400">
          그림·표·&lt;보기&gt;가 있는 문항은 이 텍스트만으로 부족할 수 있습니다 — 원본 PDF를 함께 확인해
          주세요.
        </p>
      </div>

      <SubmissionForm itemExplanationId={item.id} kind={kind} />
    </div>
  );
}
