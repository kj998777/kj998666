import Link from "next/link";
import { requireRole } from "@/lib/auth/requireRole";
import { createAdminClient } from "@/lib/supabase/admin";
import { personLabel } from "@/lib/profile/label";
import { buildSolveRows, KIND_LABEL, summarize, type SolveKind, type SolveRow } from "@/lib/ops/solves";

// 2026-10-01 원장님: 운영 현황에서 과외선생님들이 어떤 문제를 풀었는지 보기.
// 선생님별(또는 전체)로 검토 제출·판정·정답 아는 문항·넘긴 문항을 최신순으로 — 시험·번호·단원·난이도, 낸 답 vs 확정 정답,
// 맞음/틀림(다수결·원장님 확정 등), 받은 포인트, 풀이 글·사진, 문항 화면 바로가기. 관리자 전용, 서비스롤로 읽는다.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Admin = any;
const PAGE = 40;
const PERIODS: Record<string, { label: string; days: number | null }> = {
  "7": { label: "7일", days: 7 },
  "30": { label: "30일", days: 30 },
  all: { label: "전체", days: null },
};
const KINDS: (SolveKind | "all")[] = ["all", "review", "verify", "gold", "skip"];
const KIND_TAB: Record<string, string> = { all: "전체", review: "검토 제출", verify: "판정", gold: "정답 아는 문항", skip: "넘김" };

const RESULT: Record<string, { label: string; cls: string }> = {
  correct: { label: "맞음", cls: "bg-emerald-100 text-emerald-800" },
  wrong: { label: "틀림", cls: "bg-red-100 text-red-700" },
  pending: { label: "판정 전", cls: "bg-amber-100 text-amber-800" },
  accepted: { label: "반영됨", cls: "bg-sky-100 text-sky-800" },
  skip: { label: "넘김", cls: "bg-slate-100 text-slate-600" },
};
const DIFF_CLS: Record<string, string> = {
  하: "bg-green-100 text-green-800",
  중하: "bg-lime-100 text-lime-800",
  중: "bg-yellow-100 text-yellow-800",
  중상: "bg-orange-100 text-orange-800",
  상: "bg-red-100 text-red-800",
};

async function fetchAll(make: (from: number, to: number) => any): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; from < 100_000; from += 1000) {
    const { data, error } = await make(from, from + 999);
    if (error || !data) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const fmt = (t: string) =>
  new Date(t).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });

export default async function SolvesPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireRole("admin");
  const admin: Admin = createAdminClient();
  const tutorParam = one(searchParams.tutor);
  const tutor = /^[0-9a-f-]{36}$/i.test(tutorParam) ? tutorParam : "";
  const kind = (KINDS as string[]).includes(one(searchParams.kind)) ? (one(searchParams.kind) as SolveKind | "all") : "all";
  const pKey = PERIODS[one(searchParams.p)] ? one(searchParams.p) : "30";
  const since = PERIODS[pKey].days ? new Date(Date.now() - PERIODS[pKey].days! * 86400_000).toISOString() : null;
  const page = Math.max(1, Number(one(searchParams.page)) || 1);

  const scoped = (q: any, timeCol: string) => {
    let x = q;
    if (tutor) x = x.eq("tutor_id", tutor);
    if (since) x = x.gte(timeCol, since);
    return x;
  };
  const [tutors, reviews, golds, skips, judgments, ledger] = await Promise.all([
    fetchAll((a, b) => admin.from("profiles").select("*").eq("role", "tutor").order("created_at").range(a, b)),
    fetchAll((a, b) =>
      scoped(
        admin
          .from("tutor_item_reviews")
          .select("id, item_explanation_id, exam_id, item_label, tutor_id, kind, answer_display, solution, image_path, is_match, needs_verification, tiebreak, created_at"),
        "created_at"
      )
        .order("created_at", { ascending: false })
        .range(a, b)
    ),
    fetchAll((a, b) =>
      scoped(
        admin
          .from("tutor_gold_attempts")
          .select("id, tutor_id, item_explanation_id, exam_id, item_label, answer_display, solution, correct, submitted_at")
          .not("submitted_at", "is", null),
        "submitted_at"
      )
        .order("submitted_at", { ascending: false })
        .range(a, b)
    ),
    fetchAll((a, b) => scoped(admin.from("tutor_review_skips").select("tutor_id, item_explanation_id, skipped_at"), "skipped_at").order("skipped_at", { ascending: false }).range(a, b)),
    fetchAll((a, b) => {
      let q = admin.from("tutor_judgments").select("review_id, gold_attempt_id, correct, source");
      if (tutor) q = q.eq("tutor_id", tutor);
      return q.order("id").range(a, b);
    }),
    fetchAll((a, b) => {
      let q = admin.from("tutor_points_ledger").select("tutor_id, delta, reason, ref_exam_id, ref_item_label").in("reason", ["review_primary", "review_verify"]);
      if (tutor) q = q.eq("tutor_id", tutor);
      return q.order("id").range(a, b);
    }),
  ]);

  const all = buildSolveRows({ reviews, golds, skips, judgments, ledger });
  const sum = summarize(all);
  const rows = kind === "all" ? all : all.filter((r) => r.kind === kind);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown: SolveRow[] = rows.slice((page - 1) * PAGE, page * PAGE);

  // 지금 쪽 문항의 시험·단원·난이도·확정 정답
  const itemIds = Array.from(new Set(shown.map((r) => r.itemId)));
  const { data: items } = itemIds.length
    ? await admin.from("item_explanations").select("id, exam_id, item_label, area, unit, difficulty, answer_display, review_confirmed").in("id", itemIds)
    : { data: [] };
  const itemBy = new Map(((items as any[]) ?? []).map((it) => [it.id, it]));
  const examIds = Array.from(new Set(((items as any[]) ?? []).map((it) => it.exam_id)));
  const { data: exams } = examIds.length ? await admin.from("exams").select("id, name, code, status").in("id", examIds) : { data: [] };
  const examBy = new Map(((exams as any[]) ?? []).map((e) => [e.id, e]));
  const tutorBy = new Map((tutors as any[]).map((t) => [t.id, t]));
  const countBy = new Map<string, number>();
  for (const r of all) countBy.set(r.tutorId, (countBy.get(r.tutorId) ?? 0) + 1);

  const href = (over: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    const cur: Record<string, string> = { tutor, kind: kind === "all" ? "" : kind, p: pKey === "30" ? "" : pKey };
    for (const [k, v] of Object.entries({ ...cur, ...over })) if (v) u.set(k, v);
    const s = u.toString();
    return "/admin/ops/solves" + (s ? "?" + s : "");
  };
  const chip = (on: boolean) => "rounded-full border px-3 py-1 text-sm " + (on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white hover:border-slate-500");
  const judged = sum.correct + sum.wrong;

  return (
    <div className="space-y-4">
      <Link href="/admin/ops" className="text-sm link-accent">
        ← 운영 현황
      </Link>
      <div>
        <h1 className="text-lg font-semibold">과외선생님이 푼 문제</h1>
        <p className="text-sm text-slate-500">
          검토 제출·판정(두 번째 풀이)·정답 아는 문항·넘긴 문항을 최신순으로 봅니다. 낸 답과 확정 정답, 맞음/틀림, 받은 포인트, 풀이를 함께 보여
          줍니다.
        </p>
      </div>

      <div className="card space-y-3">
        <form method="get" action="/admin/ops/solves" className="flex flex-wrap items-center gap-2">
          <select name="tutor" defaultValue={tutor} className="input w-auto max-w-full" aria-label="과외선생님">
            <option value="">모든 과외선생님</option>
            {(tutors as any[]).map((t) => (
              <option key={t.id} value={t.id}>
                {personLabel(t)}
                {countBy.has(t.id) ? ` (${countBy.get(t.id)})` : ""}
              </option>
            ))}
          </select>
          {kind !== "all" && <input type="hidden" name="kind" value={kind} />}
          {pKey !== "30" && <input type="hidden" name="p" value={pKey} />}
          <button className="btn-primary py-1.5" type="submit">
            보기
          </button>
        </form>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">기간</span>
          {Object.entries(PERIODS).map(([k, v]) => (
            <Link key={k} href={href({ p: k === "30" ? "" : k, page: "" })} className={chip(pKey === k)}>
              {v.label}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">종류</span>
          {KINDS.map((k) => (
            <Link key={k} href={href({ kind: k === "all" ? "" : k, page: "" })} className={chip(kind === k)}>
              {KIND_TAB[k]}
              <span className={kind === k ? "text-slate-300" : "text-slate-400"}> {k === "all" ? all.length : sum[k as SolveKind]}</span>
            </Link>
          ))}
        </div>
        <p className="text-sm text-slate-600">
          {tutor ? <b>{personLabel(tutorBy.get(tutor) ?? { email: "?" })}</b> : "모든 과외선생님"} · {PERIODS[pKey].label} — 검토 {sum.review} · 판정 {sum.verify} ·
          정답 아는 문항 {sum.gold} · 넘김 {sum.skip}
          {judged > 0 && (
            <>
              {" "}
              · 맞음 {sum.correct}/{judged} ({Math.round((sum.correct / judged) * 100)}%)
            </>
          )}{" "}
          · 받은 포인트 {sum.points}P
        </p>
      </div>

      {shown.length === 0 ? (
        <div className="card text-sm text-slate-500">이 조건에 맞는 기록이 없습니다.</div>
      ) : (
        <ul className="space-y-2">
          {shown.map((r) => {
            const it = itemBy.get(r.itemId);
            const ex = it ? examBy.get(it.exam_id) : null;
            const res = RESULT[r.result];
            const t = tutorBy.get(r.tutorId);
            return (
              <li key={r.key} className="card space-y-1.5 py-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                  <span className="tabular-nums">{fmt(r.at)}</span>
                  {!tutor && <span className="font-medium text-slate-700">{t ? personLabel(t) : "?"}</span>}
                  <span className="badge bg-slate-100 text-slate-700">{KIND_LABEL[r.kind]}</span>
                  <span className={"badge " + res.cls} title={r.resultNote}>
                    {res.label}
                  </span>
                  <span className="text-slate-400">{r.resultNote}</span>
                  {r.points != null && <span className="ml-auto font-medium text-slate-700 tabular-nums">+{r.points}P</span>}
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="font-medium">
                    {ex ? String(ex.name).replace(/_/g, " ") : "(지워진 시험)"} {it?.item_label ?? r.label}번
                  </span>
                  {it?.difficulty && <span className={"rounded px-1.5 py-0.5 text-xs font-medium " + (DIFF_CLS[it.difficulty] ?? "bg-slate-100")}>{it.difficulty}</span>}
                  <span className="text-slate-500">{it?.unit || it?.area || ""}</span>
                </div>
                {r.kind !== "skip" && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <span>
                      낸 답 <b className="break-all">{r.answer || "-"}</b>
                    </span>
                    {it?.answer_display && (
                      <span className="text-slate-500">
                        {it.review_confirmed ? "확정 정답" : "지금 정답"} <b className="break-all text-slate-700">{it.answer_display}</b>
                      </span>
                    )}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  {r.solution && (
                    <details className="w-full">
                      <summary className="cursor-pointer text-slate-500">풀이 보기</summary>
                      <p className="mt-1 whitespace-pre-wrap break-words rounded bg-slate-50 px-2 py-1.5 text-sm text-slate-700">{r.solution.slice(0, 2000)}</p>
                    </details>
                  )}
                  {r.photoReviewId && (
                    <a href={`/admin/tutor-disputes/photo/${r.photoReviewId}`} target="_blank" rel="noreferrer" className="link-accent">
                      풀이 사진 →
                    </a>
                  )}
                  <Link href={`/admin/review-status/item/${r.itemId}`} className="link-accent">
                    문항 보기 →
                  </Link>
                  {!tutor && (
                    <Link href={href({ tutor: r.tutorId, page: "" })} className="text-slate-500 hover:underline">
                      이 선생님만
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">
            {page}/{pages}쪽 · {rows.length}건
          </span>
          <span className="flex gap-2">
            {page > 1 && (
              <Link className="btn-secondary py-1 px-3" href={href({ page: String(page - 1) })}>
                ← 이전
              </Link>
            )}
            {page < pages && (
              <Link className="btn-secondary py-1 px-3" href={href({ page: String(page + 1) })}>
                다음 →
              </Link>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
