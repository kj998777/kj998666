import Link from "next/link";
import { requireTutor } from "@/lib/auth/requireTutor";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// 2026-09-30 원장님 요청: 포인트 랭킹 — 랭킹 도입 이후 "문제를 풀어서 얻은" 포인트만 센다(0038 tutor_point_ranking).
// 보유 포인트와는 별개(환영·관리자 지급·이의 보상은 안 들어가고, 기출 구매로 쓴 포인트도 빠지지 않음).
// 다른 선생님 이름은 "31기 김○○"처럼 가려서 보여 준다.
type Row = { rank: number; points: number; label: string; me: boolean };

const MEDAL: Record<number, string> = { 1: "bg-amber-400 text-white", 2: "bg-slate-400 text-white", 3: "bg-orange-400 text-white" };

export default async function TutorRankingPage({ searchParams }: { searchParams?: { p?: string } }) {
  await requireTutor();
  const period = searchParams?.p === "month" ? "month" : "all";
  const supabase = await createClient();
  const { data, error } = (await (supabase.rpc as any)("tutor_point_ranking", { p_period: period, p_limit: 50 })) as any;
  const rows: Row[] = (data?.rows as Row[]) ?? [];
  const mine = data?.mine as { rank: number; points: number } | null;
  const started = data?.startedAt ? new Date(data.startedAt).toLocaleDateString("ko-KR") : null;

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-lg font-semibold">포인트 랭킹</h1>
        <p className="text-sm text-slate-500">
          {started ? `${started}부터 ` : ""}문제를 풀어서 얻은 포인트만 셉니다. 보유 포인트와는 별개라 기출을 사도 순위 점수는 줄지 않고,
          환영 포인트·이의 보상은 들어가지 않습니다.
        </p>
      </div>

      <div className="flex gap-2 text-sm">
        <Link href="/tutor/ranking" className={"rounded-md px-3 py-1.5 border " + (period === "all" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white")}>
          전체
        </Link>
        <Link href="/tutor/ranking?p=month" className={"rounded-md px-3 py-1.5 border " + (period === "month" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white")}>
          이번 달
        </Link>
      </div>

      {error ? (
        <div className="card text-sm text-slate-500">랭킹을 아직 준비하는 중입니다. 조금 뒤에 다시 들어와 주세요.</div>
      ) : (
        <>
          <div className="card flex items-center justify-between gap-3">
            <div className="text-sm text-slate-500">내 순위</div>
            <div className="text-right">
              {mine ? (
                <>
                  <span className="text-2xl font-semibold tabular-nums">{mine.rank}위</span>
                  <span className="ml-2 text-sm text-slate-500 tabular-nums">
                    {mine.points}P · 전체 {data?.total ?? 0}명
                  </span>
                </>
              ) : (
                <span className="text-sm text-slate-500">아직 순위가 없어요 — 문항을 풀면 올라갑니다</span>
              )}
            </div>
          </div>

          <div className="card">
            {rows.length === 0 ? (
              <p className="text-sm text-slate-500">{period === "month" ? "이번 달에는" : "아직"} 문제를 풀어 포인트를 얻은 선생님이 없습니다.</p>
            ) : (
              <ol className="divide-y divide-slate-100">
                {rows.map((r, i) => (
                  <li key={i} className={"flex items-center gap-3 py-2 " + (r.me ? "bg-amber-50 -mx-2 px-2 rounded" : "")}>
                    <span
                      className={
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums " +
                        (MEDAL[r.rank] ?? "bg-slate-100 text-slate-600")
                      }
                    >
                      {r.rank}
                    </span>
                    <span className="flex-1 min-w-0 truncate">
                      {r.label}
                      {r.me && <span className="ml-1 text-xs text-amber-700">(나)</span>}
                    </span>
                    <span className="font-medium tabular-nums">{r.points}P</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </>
      )}
    </div>
  );
}
