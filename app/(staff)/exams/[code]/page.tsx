import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import AddAnswerKeyForm from "./AddAnswerKeyForm";
import AnswerKeyRow from "./AnswerKeyRow";
import ToggleStatusButton from "./ToggleStatusButton";
import DeleteExamButton from "./DeleteExamButton";

export default async function ExamDetailPage({ params }: { params: { code: string } }) {
  const session = await requireRole("viewer");
  const canEdit = session.role === "admin" || session.role === "editor";
  const code = decodeURIComponent(params.code);

  const supabase = await createClient();
  const { data: exam } = await supabase.from("exams").select("*").eq("code", code).single();
  if (!exam) notFound();

  const { data: keys } = await supabase
    .from("answer_key")
    .select("*")
    .eq("exam_id", exam.id)
    .order("sort_order")
    .order("item_label");

  const totalPoints = (keys ?? []).reduce((s, k) => s + Number(k.points), 0);
  const studentPath = `/s/${encodeURIComponent(exam.code)}`;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold">
            {exam.name} <span className="text-slate-400 text-sm font-normal">({exam.code})</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            학생 제출 화면: <code className="bg-slate-100 px-1 rounded">{studentPath}</code>{" "}
            <Link href={`/exams/${encodeURIComponent(exam.code)}/results`} className="underline">
              채점 결과 보기
            </Link>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={"badge " + (exam.status === "열림" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600")}
          >
            {exam.status}
          </span>
          {session.role === "admin" && (
            <ToggleStatusButton code={exam.code} open={exam.status === "열림"} hasKey={(keys ?? []).length > 0} />
          )}
          {session.role === "admin" && <DeleteExamButton examId={exam.id} />}
        </div>
      </div>

      {session.role !== "admin" && exam.status !== "열림" && (
        <div className="card border-amber-300 bg-amber-50 text-amber-800 text-sm">
          시험 열기/닫기는 관리자만 할 수 있습니다. 정답을 다 등록했으면 관리자에게 열어 달라고 요청해 주세요.
        </div>
      )}

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium">정답 ({(keys ?? []).length}문항, 총 {totalPoints}점)</h2>
        </div>

        {(keys ?? []).length === 0 ? (
          <p className="text-sm text-slate-500 mb-4">아직 등록된 정답이 없습니다.</p>
        ) : (
          <table className="w-full text-sm mb-4">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-1 pr-2">번호</th>
                <th className="py-1 pr-2">유형</th>
                <th className="py-1 pr-2">정답 (여러 개는 | 로 구분)</th>
                <th className="py-1 pr-2">배점</th>
                <th className="py-1 pr-2"></th>
              </tr>
            </thead>
            <tbody>
              {(keys ?? []).map((k) => (
                <AnswerKeyRow key={k.id} code={exam.code} row={k} canEdit={canEdit} />
              ))}
            </tbody>
          </table>
        )}

        {canEdit && <AddAnswerKeyForm code={exam.code} nextSortOrder={(keys ?? []).length} />}
      </div>
    </div>
  );
}
