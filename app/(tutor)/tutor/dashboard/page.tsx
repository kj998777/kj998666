import Link from "next/link";
import { requireTutor } from "@/lib/auth/requireTutor";
import { createClient } from "@/lib/supabase/server";

const REASON_LABEL: Record<string, string> = {
  review_primary: "문항 검토(최초 제출)",
  review_verify: "문항 검토(사후 검증)",
  download_purchase: "기출 다운로드",
  admin_adjustment: "관리자 조정",
};

export default async function TutorDashboardPage() {
  const session = await requireTutor();
  const supabase = await createClient();

  const [{ data: stats }, { data: ledger }] = await Promise.all([
    supabase
      .from("tutor_stats")
      .select("points_balance, reviews_submitted, reviews_flagged")
      .eq("tutor_id", session.userId)
      .maybeSingle(),
    supabase
      .from("tutor_points_ledger")
      .select("id, delta, reason, ref_item_label, created_at")
      .eq("tutor_id", session.userId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const s = (stats as any) ?? { points_balance: 0, reviews_submitted: 0, reviews_flagged: 0 };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">내 활동</h1>
        <p className="text-sm text-slate-500">
          검토대기 문항을 풀어 포인트를 벌고, 그 포인트로 기출문제 PDF를 받을 수 있습니다.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="card text-center">
          <div className="text-3xl font-semibold text-amber-600">{s.points_balance}</div>
          <div className="text-sm text-slate-500 mt-1">보유 포인트</div>
        </div>
        <div className="card text-center">
          <div className="text-3xl font-semibold">{s.reviews_submitted}</div>
          <div className="text-sm text-slate-500 mt-1">제출한 검토</div>
        </div>
        <div className="card text-center">
          <div className={"text-3xl font-semibold " + (s.reviews_flagged > 0 ? "text-red-600" : "")}>
            {s.reviews_flagged}
          </div>
          <div className="text-sm text-slate-500 mt-1">사후 검증 불일치</div>
        </div>
      </div>

      <div className="flex gap-3">
        <Link href="/tutor/review" className="btn-primary">
          검토하러 가기
        </Link>
        <Link href="/tutor/store" className="btn-secondary">
          기출 스토어 보기
        </Link>
      </div>

      <div className="card">
        <h2 className="font-medium mb-3">최근 포인트 내역</h2>
        {(ledger ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">아직 내역이 없습니다.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-1 pr-2">날짜</th>
                <th className="py-1 pr-2">내용</th>
                <th className="py-1 pr-2 text-right">포인트</th>
              </tr>
            </thead>
            <tbody>
              {(ledger as any[]).map((l) => (
                <tr key={l.id} className="border-b border-slate-100">
                  <td className="py-1 pr-2 text-slate-500">{new Date(l.created_at).toLocaleString("ko-KR")}</td>
                  <td className="py-1 pr-2">
                    {REASON_LABEL[l.reason] ?? l.reason}
                    {l.ref_item_label && <span className="text-slate-400"> · {l.ref_item_label}번</span>}
                  </td>
                  <td className={"py-1 pr-2 text-right font-medium " + (l.delta >= 0 ? "text-emerald-600" : "text-red-600")}>
                    {l.delta >= 0 ? "+" : ""}
                    {l.delta}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
