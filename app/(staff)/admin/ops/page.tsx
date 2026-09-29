import Link from "next/link";
import { requireRole } from "@/lib/auth/requireRole";
import { createAdminClient } from "@/lib/supabase/admin";
import { personLabel } from "@/lib/profile/label";
import { listBackups } from "@/lib/ops/backup";
import { BackupDownloadButton, BackupNowButton, TrustControls } from "./OpsControls";

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

  // 신뢰도 단계 — DB 함수(0025)가 기준. 0025 전이면 모두 "정상"
  const trustEntries = await Promise.all(
    tutors.map(async (t) => {
      const { data, error } = await admin.rpc("tutor_trust_level", { p_tutor: t.id });
      return [t.id, error ? "ok" : (data as string) || "ok"] as const;
    })
  );
  const trustOf = new Map<string, string>(trustEntries);
  // 0037: 정답률(최근 50건 판정)
  const accEntries = await Promise.all(
    tutors.map(async (t) => {
      const { data, error } = await admin.rpc("tutor_accuracy", { p_tutor: t.id });
      return [t.id, error || !data ? null : { judged: Number(data.judged ?? 0), correct: Number(data.correct ?? 0) }] as const;
    })
  );
  const accOf = new Map<string, { judged: number; correct: number } | null>(accEntries);
  // 0038 포인트 랭킹(문제로 얻은 포인트만, 관리자는 이름 그대로)
  const [rankAll, rankMonth] = await Promise.all(
    ["all", "month"].map(async (p) => {
      const { data, error } = await admin.rpc("tutor_point_ranking", { p_period: p, p_limit: 10 });
      return error ? null : (data as any);
    })
  );

  // 남은 검토 문항(지금)
  const pendingIds: string[] = ((pendingExams as any[]) ?? []).map((e) => e.id);
  let queueLeft = 0;
  // 시험 id를 한 번에 수백 개 넣으면 요청 주소가 너무 길어질 수 있어 150개씩 나눠 세고 더한다(2026-09-29)
  for (let i = 0; i < pendingIds.length; i += 150) {
    const { count } = await admin
      .from("item_explanations")
      .select("id", { count: "exact", head: true })
      .in("exam_id", pendingIds.slice(i, i + 150))
      .eq("tutor_reviewed", false)
      .eq("review_confirmed", false);
    queueLeft += count ?? 0;
  }

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
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              ["전체", rankAll],
              ["이번 달", rankMonth],
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
        <h2 className="font-medium">과외선생님별 활동·신뢰도</h2>
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
                      <div>{personLabel(r.t)}</div>
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
