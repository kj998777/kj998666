import { notFound } from "next/navigation";
import { requireTutor } from "@/lib/auth/requireTutor";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPurchasedExam } from "@/lib/tutor/purchased";
import TutorExamTabs from "../TutorExamTabs";
import EditRequestForm from "./EditRequestForm";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  pending: { text: "확인 대기", cls: "bg-amber-100 text-amber-800" },
  accepted: { text: "반영됨", cls: "bg-emerald-100 text-emerald-700" },
  rejected: { text: "반영 안 함", cls: "bg-slate-100 text-slate-600" },
};

// #4: 구매한 시험의 "해설·정답 수정 요청" 탭. 현재 정답·해설을 보여 주고, 고칠 내용을 요청으로 올린다
// (원본 반영은 원장님이 검토현황에서 확정할 때). 과외선생님은 정답표·해설 RLS를 통과하지 못하므로
// 구매 확인 뒤 서비스롤로 "읽기만" 한다.
export default async function TutorEditRequestsPage({ params }: { params: { code: string } }) {
  const session = await requireTutor();
  const code = decodeURIComponent(params.code);
  const exam = await getPurchasedExam(session.userId, code);
  if (!exam) notFound();

  const admin = createAdminClient() as any;
  const supabase = await createClient();
  const [{ data: keys }, { data: expls }, { data: reqs }]: any[] = await Promise.all([
    admin.from("answer_key").select("item_label, correct_answers, type, sort_order").eq("exam_id", exam.id).order("sort_order").order("item_label"),
    admin.from("item_explanations").select("item_label, answer_display, solution").eq("exam_id", exam.id),
    (supabase.from("tutor_edit_requests") as any)
      .select("id, item_label, proposed_answer, status, created_at")
      .eq("exam_id", exam.id)
      .eq("tutor_id", session.userId)
      .order("created_at", { ascending: false }),
  ]);
  const explBy = new Map(((expls as any[]) ?? []).map((e) => [e.item_label, e]));
  const reqsBy = new Map<string, any[]>();
  for (const r of (reqs as any[]) ?? []) reqsBy.set(r.item_label, [...(reqsBy.get(r.item_label) ?? []), r]);

  return (
    <div className="space-y-4">
      <TutorExamTabs code={exam.code} name={exam.name} active="edit" />
      <p className="text-sm text-slate-500">
        정답이나 해설이 틀렸으면 문항을 펼쳐 고칠 내용을 보내 주세요. 원장님이 확인하면 정답표·해설에 반영되고, 선생님
        학생들의 채점·보고서에도 그대로 적용됩니다. <b>정답이 바뀌면 +3P</b>(해설만 반영되면 +1P)를 드려요. 정답을 바꾸자는
        요청은 풀이·메모에 근거를 10자 이상 적어야 하고, 하루 3건까지 보낼 수 있습니다(최근 30일에 반영 안 된 요청이 3건
        이상이면 잠시 보낼 수 없어요).
      </p>

      <div className="card divide-y divide-slate-100">
        {((keys as any[]) ?? []).map((k) => {
          const e = explBy.get(k.item_label);
          const mine = reqsBy.get(k.item_label) ?? [];
          const hasPending = mine.some((r) => r.status === "pending");
          return (
            <details key={k.item_label} className="py-2">
              <summary className="cursor-pointer flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium w-12">{k.item_label}번</span>
                <span>정답 {k.correct_answers}</span>
                <span className="text-xs text-slate-400">{k.type}</span>
                {mine.slice(0, 1).map((r) => (
                  <span key={r.id} className={"badge " + (STATUS_LABEL[r.status]?.cls ?? "")}>
                    내 요청: {STATUS_LABEL[r.status]?.text ?? r.status}
                  </span>
                ))}
              </summary>
              <div className="pl-2 pt-2 space-y-2 text-sm">
                {e?.solution ? (
                  <div className="bg-slate-50 rounded px-3 py-2 whitespace-pre-wrap text-slate-700 max-h-64 overflow-y-auto">
                    {e.solution}
                  </div>
                ) : (
                  <p className="text-slate-400">해설이 없습니다.</p>
                )}
                {hasPending ? (
                  <p className="text-amber-700">이 문항은 확인을 기다리는 요청이 있습니다.</p>
                ) : (
                  <EditRequestForm code={exam.code} itemLabel={k.item_label} />
                )}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
