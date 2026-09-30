import Link from "next/link";
import type { ReactNode } from "react";
import { requireTutor } from "@/lib/auth/requireTutor";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// 2026-09-30 원장님 요청: 포인트 랭킹 — 랭킹 도입 이후 "문제를 풀어서 얻은" 포인트만 센다(0038 tutor_point_ranking).
// 보유 포인트와는 별개(환영·관리자 지급·이의 보상은 안 들어가고, 기출 구매로 쓴 포인트도 빠지지 않음).
// 다른 선생님 이름은 "31기 김○○"처럼 가려서 보여 준다.
// 2026-09-30: "기수별" 보기 — 같은 기수(의대 "30기", 다른 과 "수의대 21학번")끼리 합친 포인트 순위(0041 tutor_cohort_ranking).
type Row = { rank: number; points: number; label: string; me: boolean };
type GroupRow = { rank: number; label: string; points: number; members: number; avg: number; mine: boolean };

const MEDAL: Record<number, string> = { 1: "bg-amber-400 text-white", 2: "bg-slate-400 text-white", 3: "bg-orange-400 text-white" };

function href(period: string, cohort: boolean) {
  const q = new URLSearchParams();
  if (period === "month") q.set("p", "month");
  if (cohort) q.set("v", "cohort");
  const s = q.toString();
  return s ? `/tutor/ranking?${s}` : "/tutor/ranking";
}

function Tab({ on, to, children }: { on: boolean; to: string; children: ReactNode }) {
  return (
    <Link href={to} className={"rounded-md px-3 py-1.5 border " + (on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white")}>
      {children}
    </Link>
  );
}

export default async function TutorRankingPage({ searchParams }: { searchParams?: { p?: string; v?: string } }) {
  await requireTutor();
  const period = searchParams?.p === "month" ? "month" : "all";
  const cohort = searchParams?.v === "cohort";
  const supabase = await createClient();
  const { data, error } = (await (supabase.rpc as any)("tutor_point_ranking", { p_period: period, p_limit: 50 })) as any;
  const rows: Row[] = (data?.rows as Row[]) ?? [];
  const cohortRes = cohort ? ((await (supabase.rpc as any)("tutor_cohort_ranking", { p_period: period })) as any) : null;
  const groups: GroupRow[] = (cohortRes?.data?.rows as GroupRow[]) ?? [];
  const myGroup: string | null = cohortRes?.data?.myGroup ?? null;
  const myGroupRow = groups.find((g) => g.mine) ?? null;
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

      <div className="flex flex-wrap gap-2 text-sm">
        <Tab on={!cohort} to={href(period, false)}>
          사람별
        </Tab>
        <Tab on={cohort} to={href(period, true)}>
          기수별
        </Tab>
        <span className="w-px bg-slate-200 mx-1" aria-hidden />
        <Tab on={period === "all"} to={href("all", cohort)}>
          전체
        </Tab>
        <Tab on={period === "month"} to={href("month", cohort)}>
          이번 달
        </Tab>
      </div>

      {cohort ? (
        cohortRes?.error || !cohortRes?.data ? (
          <div className="card text-sm text-slate-500">기수별 랭킹을 아직 준비하는 중입니다. 조금 뒤에 다시 들어와 주세요.</div>
        ) : (
          <>
            <div className="card flex items-center justify-between gap-3">
              <div className="text-sm text-slate-500">우리 기수{myGroup ? ` (${myGroup})` : ""}</div>
              <div className="text-right">
                {myGroupRow ? (
                  <>
                    <span className="text-2xl font-semibold tabular-nums">{myGroupRow.rank}위</span>
                    <span className="ml-2 text-sm text-slate-500 tabular-nums">
                      {myGroupRow.points}P · {myGroupRow.members}명 · 전체 {groups.length}개 기수
                    </span>
                  </>
                ) : (
                  <span className="text-sm text-slate-500">아직 순위가 없어요 — 우리 기수 누구든 문항을 풀면 올라갑니다</span>
                )}
              </div>
            </div>
            <div className="card">
              {groups.length === 0 ? (
                <p className="text-sm text-slate-500">{period === "month" ? "이번 달에는" : "아직"} 문제를 풀어 포인트를 얻은 기수가 없습니다.</p>
              ) : (
                <ol className="divide-y divide-slate-100">
                  {groups.map((g) => (
                    <li key={g.label} className={"flex items-center gap-3 py-2 " + (g.mine ? "bg-amber-50 -mx-2 px-2 rounded" : "")}>
                      <span
                        className={
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums " +
                          (MEDAL[g.rank] ?? "bg-slate-100 text-slate-600")
                        }
                      >
                        {g.rank}
                      </span>
                      <span className="flex-1 min-w-0 truncate">
                        {g.label}
                        {g.mine && <span className="ml-1 text-xs text-amber-700">(우리 기수)</span>}
                        <span className="ml-2 text-xs text-slate-400 tabular-nums">
                          {g.members}명 · 1인 평균 {g.avg}P
                        </span>
                      </span>
                      <span className="font-medium tabular-nums">{g.points}P</span>
                    </li>
                  ))}
                </ol>
              )}
              <p className="mt-2 text-xs text-slate-400">문제를 풀어 포인트를 얻은 선생님만 인원에 들어갑니다. 의대는 기수, 다른 과는 입학 연도(학번 앞 두 자리)로 묶어요.</p>
            </div>
          </>
        )
      ) : error ? (
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
