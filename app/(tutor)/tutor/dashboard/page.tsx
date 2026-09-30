import Link from "next/link";
import { requireTutor } from "@/lib/auth/requireTutor";
import { createClient } from "@/lib/supabase/server";

const REASON_LABEL: Record<string, string> = {
  // 0037: 새 문항·판정 문항을 구분해 보여 주지 않는다(블라인드)
  review_primary: "문항 검토",
  review_verify: "문항 검토",
  download_purchase: "기출 다운로드",
  admin_adjustment: "관리자 조정",
  dispute_reward: "정답 이의 채택 보상",
  worksheet_purchase: "맞춤 시험지",
};

export default async function TutorDashboardPage() {
  const session = await requireTutor();
  const supabase = await createClient();

  const [{ data: stats }, { data: ledger }] = await Promise.all([
    supabase
      .from("tutor_stats")
      .select("points_balance, reviews_submitted")
      .eq("tutor_id", session.userId)
      .maybeSingle(),
    supabase
      .from("tutor_points_ledger")
      .select("id, delta, reason, ref_item_label, created_at")
      .eq("tutor_id", session.userId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const s = (stats as any) ?? { points_balance: 0, reviews_submitted: 0 };

  // 신뢰도(0037: 정답률 등급). 0037 전이면 정답률 조회가 실패해 등급만 보인다.
  const [{ data: trust }, { data: acc }, { data: rank }] = await Promise.all([
    (supabase.rpc as any)("tutor_trust_level", { p_tutor: session.userId }),
    (supabase.rpc as any)("tutor_accuracy", { p_tutor: session.userId }),
    // 0038 포인트 랭킹(문제로 얻은 포인트만) — 내 순위만
    (supabase.rpc as any)("tutor_point_ranking", { p_period: "all", p_limit: 1 }),
  ]);
  const myRank = rank?.mine as { rank: number; points: number } | null | undefined;
  const judged = Number(acc?.judged ?? 0);
  const accPct = judged ? Math.round((Number(acc?.correct ?? 0) / judged) * 100) : null;
  const LEVEL: Record<string, { label: string; cls: string; note: string }> = {
    new: { label: "신규", cls: "text-sky-700", note: "처음 5문항 · 포인트 1배" },
    ok: { label: "검증됨", cls: "text-emerald-700", note: "포인트 1배" },
    top: { label: "우수", cls: "text-violet-700", note: "포인트 1.5배" },
    watch: { label: "주의", cls: "text-amber-700", note: "포인트 0.5배 · 제출 전부 재확인" },
    paused: { label: "정지", cls: "text-red-700", note: "새 문항 배정 멈춤" },
  };
  const lv = LEVEL[String(trust ?? "ok")] ?? LEVEL.ok;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">내 활동</h1>
        <p className="text-sm text-slate-500">
          검토대기 문항을 풀어 포인트를 벌고, 그 포인트로 기출문제 PDF를 받을 수 있습니다.
        </p>
      </div>

      {/* 2026-09-29 원장님 요청: 작은 글씨 링크라 잘 안 보였던 "처음이세요? 사용법 보기"를 크고 눈에 띄는 배너로 */}
      <Link
        href="/tutor/guide"
        className="group block rounded-2xl border-2 border-rose-300 bg-rose-50 p-4 sm:p-5 shadow-sm transition hover:border-rose-500 hover:bg-rose-100"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-rose-600 text-xl font-bold text-white">
              ?
            </span>
            <div>
              <p className="text-lg sm:text-xl font-bold text-rose-700">처음이신가요? 사용법부터 보세요</p>
              <p className="text-sm text-rose-900/80 mt-0.5">
                그림과 화살표로 단계별 설명 — 검토하고 포인트 받기 · 기출 스토어 · 학생 제출·보고서 · 버그 신고
              </p>
            </div>
          </div>
          <span className="inline-flex items-center justify-center rounded-xl bg-rose-600 px-5 py-3 text-base font-semibold text-white group-hover:bg-rose-700 sm:shrink-0">
            사용법 보기 →
          </span>
        </div>
      </Link>

      {trust === "paused" && (
        <div className="card border-red-300 bg-red-50 text-sm text-red-700">
          지금은 새 검토 문항 배정이 잠시 멈춰 있습니다. 최근 제출의 정답률이 50%보다 낮아 원장님이 확인하는 중입니다. 기출
          스토어는 그대로 쓸 수 있고, 궁금한 점은 원장님께 문의해 주세요.
        </div>
      )}
      {trust === "watch" && (
        <div className="card border-amber-300 bg-amber-50 text-sm text-amber-800">
          최근 제출의 정답률이 70%보다 낮아, 당분간 제출하신 문항은 모두 한 번 더 확인하고 포인트는 절반으로 적립됩니다.
          정답률이 다시 오르면 자동으로 풀립니다. 문제를 조금 더 꼼꼼히 확인해 주세요.
        </div>
      )}
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <div className="card text-center">
          <div className="text-2xl sm:text-3xl font-semibold text-amber-600">{s.points_balance}</div>
          <div className="text-xs sm:text-sm text-slate-500 mt-1">보유 포인트</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl sm:text-3xl font-semibold">{s.reviews_submitted}</div>
          <div className="text-xs sm:text-sm text-slate-500 mt-1">제출한 검토</div>
        </div>
        <div className="card text-center">
          <div className={"text-2xl sm:text-3xl font-semibold " + lv.cls}>{lv.label}</div>
          <div className="text-xs sm:text-sm text-slate-500 mt-1">
            등급 · {lv.note}
            <br />
            {accPct === null ? "정답률은 판정이 쌓이면 보여요" : `정답률 ${accPct}% (최근 ${judged}건)`}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link href="/tutor/review" className="btn-primary">
          검토하러 가기
        </Link>
        <Link href="/tutor/store" className="btn-secondary">
          기출 스토어 보기
        </Link>
        <Link href="/tutor/worksheet" className="btn-secondary">
          맞춤 시험지 만들기
        </Link>
        <Link href="/tutor/ranking" className="btn-secondary">
          랭킹{myRank ? ` · 내 순위 ${myRank.rank}위` : ""}
        </Link>
      </div>

      <div className="card">
        <h2 className="font-medium mb-3">최근 포인트 내역</h2>
        {(ledger ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">아직 내역이 없습니다.</p>
        ) : (
          <div className="table-wrap">
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
          </div>
        )}
      </div>
    </div>
  );
}
