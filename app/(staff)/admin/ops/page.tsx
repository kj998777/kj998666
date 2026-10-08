import Link from "next/link";
import { requireRole } from "@/lib/auth/requireRole";
import { createAdminClient } from "@/lib/supabase/admin";
import { personLabel } from "@/lib/profile/label";
import { listBackups } from "@/lib/ops/backup";
import { BackupDownloadButton, BackupNowButton, RegradeAllButton, RejudgeButton, TrustControls } from "./OpsControls";
import { hasScanPdf } from "@/lib/ai/pdf";
import { buildHealthChecks, STALE_SECOND_DAYS, worstLevel, type HealthCheck } from "@/lib/ops/health";
import { dailyFlow } from "@/lib/ops/flow";
import FlowChart from "./FlowChart";

// 운영 현황(2026-09-28 원장님 요청 8·9·10) — 과외선생님 검토·포인트·기출 구매 흐름을 한눈에 보고,
// 신뢰도(사후 검증 불일치) 관리와 정기 백업 확인까지 한 화면에서 한다. 관리자 전용, 집계는 서비스롤로 읽어
// 이 화면에서 계산한다(행 수가 적은 지금 규모에서는 이쪽이 단순하다).

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Admin = any;

const PERIODS: Record<string, { label: string; days: number | null }> = {
  "7": { label: "최근 7일", days: 7 },
  "30": { label: "최근 30일", days: 30 },
  all: { label: "전체", days: null },
};

const REASON_LABEL: Record<string, string> = {
  review_primary: "문항 검토",
  review_verify: "사후 검증",
  download_purchase: "기출 구매",
  admin_adjustment: "관리자 지급·조정",
  dispute_reward: "정답 이의 채택 보상",
  worksheet_purchase: "맞춤 시험지(과외)",
  placement_purchase: "입학테스트(과외)",
  first_bonus: "처음 3문항 보너스",
  referral_bonus: "친구 초대 보너스",
};

// 0037: 정답률 등급
const TRUST: Record<string, { label: string; cls: string; tip: string }> = {
  new: { label: "신규", cls: "bg-sky-100 text-sky-700", tip: "제출 5개 전 — 전부 한 명 더 확인, 판정자는 맡지 않음" },
  ok: { label: "검증됨", cls: "bg-emerald-100 text-emerald-700", tip: "10%만 무작위 재확인 · 포인트 1배" },
  top: { label: "우수", cls: "bg-violet-100 text-violet-700", tip: "30건 이상 95%↑ — 5%만 재확인 · 포인트 1.5배" },
  watch: { label: "주의", cls: "bg-amber-100 text-amber-800", tip: "정답률 70%↓ — 제출 전부 재확인 · 포인트 0.5배" },
  paused: { label: "정지", cls: "bg-red-100 text-red-700", tip: "정답률 50%↓(또는 수동) — 새 문항을 배정받지 못합니다" },
};

/** 1000행씩 끝까지 읽기 */
async function fetchAll(make: (from: number, to: number) => any): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; from < 200_000; from += 1000) {
    const { data, error } = await make(from, from + 999);
    if (error || !data) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="card py-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

const LEVEL_CLS: Record<string, string> = {
  ok: "bg-emerald-50 text-emerald-800 border-emerald-200",
  warn: "bg-amber-50 text-amber-900 border-amber-200",
  bad: "bg-red-50 text-red-800 border-red-200",
};
const LEVEL_DOT: Record<string, string> = { ok: "bg-emerald-500", warn: "bg-amber-500", bad: "bg-red-500" };

function HealthItem({ c }: { c: HealthCheck }) {
  const body = (
    <div className={"rounded-lg border px-3 py-2 h-full " + LEVEL_CLS[c.level]}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5">
          <span className={"inline-block w-2 h-2 rounded-full " + LEVEL_DOT[c.level]} />
          {c.label}
        </span>
        <span className="font-semibold tabular-nums text-sm">{c.value}</span>
      </div>
      {c.level !== "ok" && <div className="text-[11px] mt-0.5 opacity-80">{c.hint}</div>}
    </div>
  );
  return c.href && c.level !== "ok" ? (
    <Link href={c.href} className="block hover:opacity-90">
      {body}
    </Link>
  ) : (
    body
  );
}

function fmtSize(n: number): string {
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + "MB";
  if (n >= 1024) return Math.round(n / 1024) + "KB";
  return n + "B";
}

export default async function OpsPage({ searchParams }: { searchParams?: { p?: string } }) {
  await requireRole("admin");
  const admin: Admin = createAdminClient();
  const pKey = searchParams?.p && PERIODS[searchParams.p] ? searchParams.p : "7";
  const period = PERIODS[pKey];
  const since = period.days ? new Date(Date.now() - period.days * 86400_000).toISOString() : null;
  const inPeriod = (t: string | null | undefined) => !since || (!!t && t >= since);

  const [reviews, ledger, purchases, profiles, statsRes, pendingExams, backups] = await Promise.all([
    fetchAll((a, b) => {
      let q = admin.from("tutor_item_reviews").select("tutor_id, kind, is_match, created_at").order("created_at").range(a, b);
      if (since) q = q.gte("created_at", since);
      return q;
    }),
    fetchAll((a, b) => {
      let q = admin.from("tutor_points_ledger").select("tutor_id, delta, reason, created_at").order("created_at").range(a, b);
      if (since) q = q.gte("created_at", since);
      return q;
    }),
    fetchAll((a, b) => {
      let q = admin.from("tutor_exam_purchases").select("tutor_id, exam_id, purchased_at").order("purchased_at").range(a, b);
      if (since) q = q.gte("purchased_at", since);
      return q;
    }),
    fetchAll((a, b) => admin.from("profiles").select("*").order("created_at").range(a, b)),
    admin.from("tutor_stats").select("*"),
    fetchAll((a, b) => admin.from("exams").select("id").eq("status", "검수대기").order("id").range(a, b)),
    listBackups(admin),
  ]);

  const stats: any[] = statsRes?.data ?? [];
  const tutors = profiles.filter((p) => p.role === "tutor");

  // 2026-10-08 최적화: 아래 조회 묶음(신뢰도·정답률·랭킹·남은 검토·운영 점검)은 서로 기다릴 필요가 없어
  // 예전처럼 차례로(6단계) 기다리지 않고 한꺼번에 보낸다.
  // 신뢰도 단계 — DB 함수(0025)가 기준. 0025 전이면 모두 "정상"
  const trustP = Promise.all(
    tutors.map(async (t) => {
      const { data, error } = await admin.rpc("tutor_trust_level", { p_tutor: t.id });
      return [t.id, error ? "ok" : (data as string) || "ok"] as const;
    })
  );
  // 0037: 정답률(최근 50건 판정)
  const accP = Promise.all(
    tutors.map(async (t) => {
      const { data, error } = await admin.rpc("tutor_accuracy", { p_tutor: t.id });
      return [t.id, error || !data ? null : { judged: Number(data.judged ?? 0), correct: Number(data.correct ?? 0) }] as const;
    })
  );
  // 0038 포인트 랭킹(문제로 얻은 포인트만, 관리자는 이름 그대로)
  const rankP = Promise.all(
    ["all", "month"].map(async (p) => {
      const { data, error } = await admin.rpc("tutor_point_ranking", { p_period: p, p_limit: 10 });
      return error ? null : (data as any);
    })
  );
  // 0041 기수별(전체 기간)
  const cohortP = (async () => {
    const { data, error } = await admin.rpc("tutor_cohort_ranking", { p_period: "all" });
    return error ? null : (data as any);
  })();

  // 남은 검토 문항(지금)
  const pendingIds: string[] = ((pendingExams as any[]) ?? []).map((e) => e.id);
  // 시험 id를 한 번에 수백 개 넣으면 요청 주소가 너무 길어질 수 있어 150개씩 나눠 세고 더한다(2026-09-29)
  const queueChunks: string[][] = [];
  for (let i = 0; i < pendingIds.length; i += 150) queueChunks.push(pendingIds.slice(i, i + 150));
  const queueP = Promise.all(
    queueChunks.map(async (chunk) => {
      const { count } = await admin
        .from("item_explanations")
        .select("id", { count: "exact", head: true })
        .in("exam_id", chunk)
        .eq("tutor_reviewed", false)
        .eq("review_confirmed", false);
      return count ?? 0;
    })
  ).then((counts) => counts.reduce((a, b) => a + b, 0));

  // 운영 점검(2026-09-30): 지금 손봐야 할 것 — 표가 없는 예전 DB면 0으로 둔다
  const since30 = new Date(Date.now() - 30 * 86400_000).toISOString();
  const headCount = async (q: any) => {
    const { count, error } = await q;
    return error ? 0 : count ?? 0;
  };
  const healthP = Promise.all([
    headCount(admin.from("item_explanations").select("id", { count: "exact", head: true }).eq("review_stage", "admin").eq("review_confirmed", false)),
    fetchAll((a, b) => admin.from("item_explanations").select("id").eq("review_stage", "second").eq("review_confirmed", false).order("id").range(a, b)),
    headCount(admin.from("tutor_edit_requests").select("id", { count: "exact", head: true }).eq("status", "pending")),
    headCount(admin.from("bug_reports").select("id", { count: "exact", head: true }).in("status", ["접수", "확인 중"])),
    fetchAll((a, b) => admin.from("exam_pdf_meta").select("exam_id, replaced_with_digitized").order("exam_id").range(a, b)),
    fetchAll((a, b) => admin.from("item_explanations").select("exam_id").order("id").range(a, b)),
    fetchAll((a, b) => admin.from("tutor_item_reviews").select("kind, created_at").gte("created_at", since30).order("created_at").range(a, b)),
    fetchAll((a, b) => admin.from("tutor_points_ledger").select("delta, created_at").gte("created_at", since30).order("created_at").range(a, b)),
  ]);
  const [
    trustEntries,
    accEntries,
    [rankAll, rankMonth],
    rankCohort,
    queueLeft,
    [adminStage, secondItems, pendingEdits, openBugs, pdfMeta, itemExamRows, flowReviews, flowLedger],
  ] = await Promise.all([trustP, accP, rankP, cohortP, queueP, healthP]);
  const trustOf = new Map<string, string>(trustEntries);
  const accOf = new Map<string, { judged: number; correct: number } | null>(accEntries);
  let staleSecond = 0;
  {
    const ids = secondItems.map((r: any) => r.id);
    const latest = new Map<string, string>();
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 150) chunks.push(ids.slice(i, i + 150));
    const pages = await Promise.all(
      chunks.map((chunk) =>
        admin.from("tutor_item_reviews").select("item_explanation_id, created_at").in("item_explanation_id", chunk).eq("kind", "primary")
      )
    );
    for (const { data } of pages as { data: any[] | null }[]) {
      for (const r of (data as any[]) ?? []) {
        const cur = latest.get(r.item_explanation_id);
        if (!cur || r.created_at > cur) latest.set(r.item_explanation_id, r.created_at);
      }
    }
    const cut = Date.now() - STALE_SECOND_DAYS * 86400_000;
    for (const t of latest.values()) if (new Date(t).getTime() <= cut) staleSecond++;
  }
  const withPdf = new Set(pdfMeta.map((m: any) => m.exam_id));
  const noPdf = new Set(itemExamRows.map((r: any) => r.exam_id).filter((id: string) => !withPdf.has(id))).size;
  const replaced = pdfMeta.filter((m: any) => m.replaced_with_digitized).map((m: any) => m.exam_id as string);
  const scanOk = await Promise.all(replaced.slice(0, 40).map((id) => hasScanPdf(admin, id).catch(() => true)));
  const scanMissing = scanOk.filter((x) => !x).length;
  const trustVals = Array.from(trustOf.values());
  const health = buildHealthChecks({
    now: Date.now(),
    adminStage,
    staleSecond,
    pendingEditRequests: pendingEdits,
    openBugs,
    waitingAccounts: profiles.filter((p) => p.role === "대기").length,
    watchTutors: trustVals.filter((v) => v === "watch").length,
    pausedTutors: trustVals.filter((v) => v === "paused").length,
    lastBackupName: backups[0]?.name ?? null,
    scanMissing,
    noPdf,
  });
  const healthWorst = worstLevel(health);
  const flow = dailyFlow(flowReviews, flowLedger, 30, Date.now());

  // 요약
  const primaries = reviews.filter((r) => r.kind === "primary");
  const verifies = reviews.filter((r) => r.kind === "verify");
  const mismatches = verifies.filter((r) => r.is_match === false).length;
  const issued = ledger.filter((l) => l.delta > 0).reduce((s, l) => s + l.delta, 0);
  const spent = ledger.filter((l) => l.delta < 0).reduce((s, l) => s - l.delta, 0);
  const byReason = new Map<string, number>();
  for (const l of ledger) byReason.set(l.reason, (byReason.get(l.reason) ?? 0) + l.delta);
  const newSignups = profiles.filter((p) => inPeriod(p.created_at)).length;
  const waiting = profiles.filter((p) => p.role === "대기").length;

  // 많이 받은 기출
  const buyCount = new Map<string, number>();
  for (const p of purchases) buyCount.set(p.exam_id, (buyCount.get(p.exam_id) ?? 0) + 1);
  const topExamIds = Array.from(buyCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  let examName = new Map<string, { name: string; code: string }>();
  if (topExamIds.length) {
    const { data } = await admin.from("exams").select("id, name, code").in("id", topExamIds.map(([id]) => id));
    examName = new Map(((data as any[]) ?? []).map((e) => [e.id, { name: e.name, code: e.code }]));
  }

  // 과외선생님 표
  const periodReviews = new Map<string, number>();
  for (const r of reviews) periodReviews.set(r.tutor_id, (periodReviews.get(r.tutor_id) ?? 0) + 1);
  const periodPoints = new Map<string, number>();
  for (const l of ledger) if (l.delta > 0) periodPoints.set(l.tutor_id, (periodPoints.get(l.tutor_id) ?? 0) + l.delta);
  const statOf = new Map(stats.map((s) => [s.tutor_id, s]));
  const tutorRows = tutors
    .map((t) => {
      const s = statOf.get(t.id) ?? {};
      const flagged = Number(s.reviews_flagged ?? 0);
      const base = Number(s.trust_baseline_flagged ?? 0);
      return {
        t,
        periodReviews: periodReviews.get(t.id) ?? 0,
        periodPoints: periodPoints.get(t.id) ?? 0,
        total: Number(s.reviews_submitted ?? 0),
        balance: Number(s.points_balance ?? 0),
        flagged,
        effFlagged: Math.max(0, flagged - base),
        manualPaused: !!s.review_paused,
        trust: trustOf.get(t.id) ?? "ok",
        acc: accOf.get(t.id) ?? null,
      };
    })
    .sort(
      (a, b) =>
        Number(["watch", "paused"].includes(b.trust)) - Number(["watch", "paused"].includes(a.trust)) ||
        b.periodReviews - a.periodReviews ||
        b.total - a.total
    );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">운영 현황</h1>
          <p className="text-sm text-slate-500">과외선생님 검토·포인트·기출 구매 흐름과 신뢰도, 정기 백업을 한눈에 봅니다.</p>
        </div>
        <div className="flex gap-1 text-sm">
          {Object.entries(PERIODS).map(([k, v]) => (
            <Link
              key={k}
              href={`/admin/ops?p=${k}`}
              className={"badge " + (k === pKey ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600")}
            >
              {v.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="card space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium">운영 점검</h2>
          <span className={"text-xs " + (healthWorst === "ok" ? "text-emerald-700" : healthWorst === "warn" ? "text-amber-700" : "text-red-700")}>
            {healthWorst === "ok" ? "손볼 것 없음" : `손볼 것 ${health.filter((c) => c.level !== "ok").length}가지 — 눌러서 바로 가기`}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {health.map((c) => (
            <HealthItem key={c.key} c={c} />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        <Stat label="문항 검토 제출" value={primaries.length} sub={period.label} />
        <Stat label="사후 검증" value={verifies.length} sub={mismatches ? `불일치 ${mismatches}건` : "불일치 없음"} />
        <Stat label="포인트 발행 / 사용" value={`${issued} / ${spent}`} sub="P" />
        <Stat label="기출 구매" value={purchases.length} sub={period.label} />
        <Stat label="남은 검토 문항" value={queueLeft} sub="지금 기준" />
        <Stat label="승인 대기 계정" value={waiting} sub={waiting ? "계정 관리에서 승인" : "없음"} />
        <Stat label="새 가입" value={newSignups} sub={period.label} />
        <Stat label="과외선생님" value={tutors.length} sub="명" />
      </div>

      <div className="card space-y-2">
        <h2 className="font-medium">최근 30일 흐름</h2>
        <FlowChart days={flow} />
        <p className="text-xs text-slate-400">한국 날짜 기준 · 막대에 손가락(마우스)을 올리면 그날 숫자가 보입니다.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card space-y-2">
          <h2 className="font-medium">많이 받은 기출 ({period.label})</h2>
          {topExamIds.length === 0 ? (
            <p className="text-sm text-slate-500">이 기간에 구매된 기출이 없습니다.</p>
          ) : (
            <ol className="text-sm space-y-1">
              {topExamIds.map(([id, n], i) => {
                const e = examName.get(id);
                return (
                  <li key={id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="text-slate-400 tabular-nums mr-1">{i + 1}.</span>
                      {e ? (
                        <Link href={`/exams/${encodeURIComponent(e.code)}`} className="hover:underline">
                          {e.name}
                        </Link>
                      ) : (
                        "(삭제된 시험)"
                      )}
                    </span>
                    <span className="tabular-nums text-slate-600 shrink-0">{n}회</span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
        <div className="card space-y-2">
          <h2 className="font-medium">포인트 흐름 ({period.label})</h2>
          {byReason.size === 0 ? (
            <p className="text-sm text-slate-500">이 기간에 포인트 변동이 없습니다.</p>
          ) : (
            <ul className="text-sm space-y-1">
              {Array.from(byReason.entries()).map(([reason, sum]) => (
                <li key={reason} className="flex justify-between gap-2">
                  <span>{REASON_LABEL[reason] ?? reason}</span>
                  <span className={"tabular-nums " + (sum < 0 ? "text-red-600" : "text-emerald-700")}>
                    {sum > 0 ? "+" : ""}
                    {sum}P
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {(rankAll || rankMonth) && (
        <div className="card space-y-2">
          <h2 className="font-medium">포인트 랭킹</h2>
          <p className="text-xs text-slate-500">
            {rankAll?.startedAt ? `${new Date(rankAll.startedAt).toLocaleDateString("ko-KR")}부터 ` : ""}문제를 풀어 얻은 포인트만(검토·판정 제출) — 보유
            포인트와 별개. 과외선생님 화면(랭킹)에는 다른 사람 이름이 가려져 보입니다.
          </p>
          <div className={"grid gap-4 " + (rankCohort ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
            {[
              ["전체", rankAll],
              ["이번 달", rankMonth],
              ...(rankCohort
                ? [["기수별(전체)", { rows: (rankCohort.rows ?? []).slice(0, 10).map((g: any) => ({ ...g, label: `${g.label} · ${g.members}명` })) }]]
                : []),
            ].map(([title, r]: any) => (
              <div key={title}>
                <div className="text-sm font-medium mb-1">{title}</div>
                {!r?.rows?.length ? (
                  <p className="text-sm text-slate-400">아직 없음</p>
                ) : (
                  <ol className="text-sm space-y-0.5">
                    {r.rows.map((x: any, i: number) => (
                      <li key={i} className="flex justify-between gap-2">
                        <span>
                          <span className="inline-block w-7 text-slate-400 tabular-nums">{x.rank}.</span>
                          {x.label}
                        </span>
                        <span className="tabular-nums">{x.points}P</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">과외선생님별 활동·신뢰도</h2>
          {/* 2026-10-01: 선생님들이 어떤 문제를 풀었는지(낸 답·맞음/틀림·포인트·풀이) */}
          <Link href="/admin/ops/solves" className="btn-secondary py-1 px-3 text-sm">
            과외선생님이 푼 문제 보기 →
          </Link>
        </div>
        <p className="text-xs text-slate-500">
          신뢰도는 <b>정답률</b>(최근 판정 50건 — 다수결·원장님 확정·정답 아는 문항·이의제기로 누가 맞았는지 정해진 것)로
          정합니다. 제출 5개 전은 <b>신규</b>, 70% 미만 <b>주의</b>(전부 재확인·포인트 0.5배), 50% 미만 <b>정지</b>, 30건 이상
          95% 이상이면 <b>우수</b>(포인트 1.5배). &ldquo;신뢰도 초기화&rdquo;는 지금까지의 판정을 빼고 다시 셉니다.
        </p>
        {tutorRows.length === 0 ? (
          <p className="text-sm text-slate-500">아직 과외선생님이 없습니다.</p>
        ) : (
          <div className="table-wrap">
            <table className="w-full min-w-[40rem] sm:min-w-0 text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-1.5 pr-2">과외선생님</th>
                  <th className="py-1.5 pr-2 text-right">검토({period.label})</th>
                  <th className="py-1.5 pr-2 text-right">받은 P</th>
                  <th className="py-1.5 pr-2 text-right">전체 검토</th>
                  <th className="py-1.5 pr-2 text-right">보유 P</th>
                  <th className="py-1.5 pr-2 text-right">정답률</th>
                  <th className="py-1.5 pr-2">신뢰도</th>
                  <th className="py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {tutorRows.map((r) => (
                  <tr key={r.t.id} className="border-b border-slate-100 align-middle">
                    <td className="py-1.5 pr-2">
                      <Link href={`/admin/ops/solves?tutor=${r.t.id}`} className="link-accent" title="이 선생님이 푼 문제 보기">
                        {personLabel(r.t)}
                      </Link>
                      {(r.t.display_name || r.t.cohort) && <div className="text-xs text-slate-400">{r.t.email}</div>}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{r.periodReviews}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{r.periodPoints}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{r.total}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{r.balance}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {r.acc && r.acc.judged ? `${Math.round((r.acc.correct / r.acc.judged) * 100)}%` : "—"}
                      {r.acc && r.acc.judged ? <span className="text-xs text-slate-400"> ({r.acc.correct}/{r.acc.judged})</span> : null}
                    </td>
                    <td className="py-1.5 pr-2">
                      <span className={"badge " + (TRUST[r.trust] ?? TRUST.ok).cls} title={(TRUST[r.trust] ?? TRUST.ok).tip}>
                        {(TRUST[r.trust] ?? TRUST.ok).label}
                        {r.manualPaused ? " (수동)" : ""}
                      </span>
                    </td>
                    <td className="py-1.5">
                      <TrustControls tutorId={r.t.id} level={r.trust} manualPaused={r.manualPaused} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-slate-400">
          불일치 내용은 <Link href="/admin/tutor-disputes" className="link-accent">과외 검토 분쟁</Link>에서 볼 수 있습니다.
        </p>
      </div>

      <div className="card space-y-2">
        <h2 className="font-medium">정답률 기록 다시 맞추기</h2>
        <p className="text-xs text-slate-500">
          예전에는 객관식 답을 &ldquo;④&rdquo;와 &ldquo;4번&rdquo;처럼 다르게 적으면 다른 답으로 봐서, 맞게 푼 선생님이 &ldquo;틀림&rdquo;으로 기록된
          경우가 있었습니다(9월 30일 고침). 이 버튼은 &ldquo;틀림&rdquo; 기록을 확정된 정답과 다시 비교해, 사실은 맞은 것만 &ldquo;맞음&rdquo;으로
          바꿉니다(반대로는 바꾸지 않음). 먼저 몇 건인지 보고 고를 수 있어요. 여러 번 눌러도 안전합니다.
        </p>
        <RejudgeButton />
      </div>

      <div className="card space-y-2">
        <h2 className="font-medium">학생 채점 결과 전체 다시 매기기</h2>
        <p className="text-xs text-slate-500">
          정답표를 고치면 이제는 그 시험의 제출이 자동으로 다시 채점되지만(10월 3일 고침), 그 전에 고친 정답표는 기존 채점에
          반영되지 않았을 수 있습니다. 이 버튼은 채점 결과가 있는 모든 시험을 지금 정답표로 다시 매겨, 점수나 정오가 달라지는
          제출만 고칩니다(찍음 표시는 그대로). 먼저 무엇이 바뀌는지 보고 실행할 수 있고, 여러 번 눌러도 안전합니다.
        </p>
        <RegradeAllButton />
      </div>

      <div className="card space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-medium">정기 백업</h2>
            <p className="text-xs text-slate-500">
              일주일에 한 번 자동으로 정답표·해설·학생 제출·포인트 기록 등을 파일로 저장하고 최근 8개를 보관합니다(AI 키 같은
              비밀값과 PDF 파일은 제외). 컴퓨터에도 한 부씩 내려받아 두시면 더 안전합니다.
            </p>
          </div>
          <BackupNowButton />
        </div>
        {backups.length === 0 ? (
          <p className="text-sm text-slate-500">
            아직 백업이 없습니다. 0025 마이그레이션을 실행한 뒤 &ldquo;지금 백업&rdquo;을 눌러 보세요(이후로는 자동).
          </p>
        ) : (
          <ul className="text-sm divide-y divide-slate-100">
            {backups.map((b) => (
              <li key={b.name} className="py-1.5 flex items-center justify-between gap-2">
                <span className="tabular-nums">
                  {b.name.replace(".json.gz", "").replace("_", " ").replace(/(\d{2})(\d{2})$/, "$1:$2")}
                  <span className="text-xs text-slate-400 ml-2">{fmtSize(b.size)}</span>
                </span>
                <BackupDownloadButton name={b.name} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
