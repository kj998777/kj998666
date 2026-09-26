import Link from "next/link";
import { requireTutor } from "@/lib/auth/requireTutor";
import { createClient } from "@/lib/supabase/server";
import PurchaseButton from "./PurchaseButton";

// exams_select_tutor_store RLS 정책 덕분에 여기서 select("*")를 해도 "지금 판매 중"이거나
// "이미 구매한" 시험만 자동으로 걸러져서 내려온다 — 앱 코드에서 따로 필터링할 필요 없음.
export default async function TutorStorePage() {
  const session = await requireTutor();
  const supabase = await createClient();

  const [{ data: exams }, { data: purchases }] = await Promise.all([
    supabase
      .from("exams")
      .select("id, code, name, tutor_download_cost")
      .order("name"),
    supabase.from("tutor_exam_purchases").select("exam_id").eq("tutor_id", session.userId),
  ]);

  const ownedExamIds = new Set(((purchases as any[]) ?? []).map((p) => p.exam_id));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">기출 스토어</h1>
          <p className="text-sm text-slate-500">
            포인트로 기출문제 PDF를 받을 수 있습니다. 한 번 구매하면 다시 받을 때는 포인트가 들지
            않습니다.
          </p>
        </div>
        <Link href="/tutor/store/purchases" className="text-sm text-blue-600 whitespace-nowrap">
          구매 내역 →
        </Link>
      </div>

      <div className="card">
        {((exams as any[]) ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">지금 받을 수 있는 기출문제가 없습니다.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-1 pr-2">시험</th>
                <th className="py-1 pr-2 text-right">필요 포인트</th>
                <th className="py-1 pr-2"></th>
              </tr>
            </thead>
            <tbody>
              {(exams as any[]).map((e) => {
                const owned = ownedExamIds.has(e.id);
                return (
                  <tr key={e.id} className="border-b border-slate-100">
                    <td className="py-1 pr-2">
                      {e.name} <span className="text-slate-400">({e.code})</span>
                    </td>
                    <td className="py-1 pr-2 text-right">
                      {owned ? <span className="text-emerald-600">구매함</span> : `${e.tutor_download_cost}P`}
                    </td>
                    <td className="py-1 pr-2">
                      {owned ? (
                        <a
                          href={`/tutor/store/${encodeURIComponent(e.code)}/download`}
                          className="btn-secondary py-1 px-3 inline-block"
                        >
                          다운로드
                        </a>
                      ) : (
                        <PurchaseButton examId={e.id} cost={e.tutor_download_cost} />
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
