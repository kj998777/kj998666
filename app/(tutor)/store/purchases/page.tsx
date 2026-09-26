import Link from "next/link";
import { requireTutor } from "@/lib/auth/requireTutor";
import { createClient } from "@/lib/supabase/server";

export default async function TutorPurchasesPage() {
  const session = await requireTutor();
  const supabase = await createClient();

  const { data: purchases } = (await supabase
    .from("tutor_exam_purchases")
    .select("id, exam_id, points_spent, purchased_at")
    .eq("tutor_id", session.userId)
    .order("purchased_at", { ascending: false })) as any;

  const examIds = ((purchases as any[]) ?? []).map((p) => p.exam_id);
  const { data: exams } =
    examIds.length > 0
      ? ((await supabase.from("exams").select("id, code, name").in("id", examIds)) as any)
      : { data: [] as any[] };
  const examById = new Map(((exams as any[]) ?? []).map((e) => [e.id, e]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">구매한 기출문제</h1>
          <p className="text-sm text-slate-500">한 번 구매하면 몇 번이든 다시 받을 수 있습니다.</p>
        </div>
        <Link href="/tutor/store" className="text-sm text-blue-600 whitespace-nowrap">
          ← 스토어로
        </Link>
      </div>
      <div className="card">
        {((purchases as any[]) ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">아직 구매한 시험이 없습니다.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-1 pr-2">시험</th>
                <th className="py-1 pr-2 text-right">사용 포인트</th>
                <th className="py-1 pr-2">구매일</th>
                <th className="py-1 pr-2"></th>
              </tr>
            </thead>
            <tbody>
              {(purchases as any[]).map((p) => {
                const exam = examById.get(p.exam_id);
                return (
                  <tr key={p.id} className="border-b border-slate-100">
                    <td className="py-1 pr-2">
                      {exam?.name ?? "(삭제된 시험)"} {exam && <span className="text-slate-400">({exam.code})</span>}
                    </td>
                    <td className="py-1 pr-2 text-right">{p.points_spent}</td>
                    <td className="py-1 pr-2 text-slate-500">
                      {new Date(p.purchased_at).toLocaleDateString("ko-KR")}
                    </td>
                    <td className="py-1 pr-2">
                      {exam && (
                        <a
                          href={`/tutor/store/${encodeURIComponent(exam.code)}/download`}
                          className="btn-secondary py-1 px-2 inline-block"
                        >
                          다운로드
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
