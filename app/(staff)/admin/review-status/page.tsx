import Link from "next/link";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { toKeyAnswer, tutorAnswerMatches } from "@/lib/review/confirm";
import ApproveReviewButton from "../../exams/[code]/ApproveReviewButton";
import { ConfirmItemControl, ConfirmMatchedButton, EditRequestControl } from "./ConfirmControls";
import LocatePanel from "./LocatePanel";
import { getLocateSummary } from "@/lib/ai/locate";
import { fetchAllIn, fetchAllPages } from "@/lib/supabase/fetchAll";
import { personLabel } from "@/lib/profile/label";

export const dynamic = "force-dynamic";

// #3 관리자 검토현황: 검수대기 시험(과 정답이 아직 확정 안 된 문항이 남은 시험)을 시험별로 모아,
// 문항마다 정답표(AI) 답 · 과외선생님 제출 답 · 사후검증 결과 · 확정 상태를 보여 주고 바로 확정한다.

const CONF_LABEL: Record<string, string> = { high: "높음", medium: "보통", low: "낮음", fail: "실패" };
const SOURCE_LABEL: Record<string, string> = {
  auto_match: "과외 답 일치",
  admin: "관리자 확정",
  legacy: "이전 확정",
  ai_confident: "AI 확신",
};

type Item = {
  id: string;
  exam_id: string;
  item_label: string;
  answer_display: string;
  tutor_reviewed: boolean;
  claimed_by: string | null;
  claim_expires_at: string | null;
  review_confirmed: boolean;
  review_confirm_source: string | null;
  ai_answer_display: string | null;
  difficulty: string | null;
};

// 2026-09-29 원장님 요청: 검토현황에서 문항 난이도도 함께 보기(과외 적립 포인트도 난이도로 정해짐 — 0028)
const DIFF_CLS: Record<string, string> = {
  하: "bg-slate-100 text-slate-600",
  중하: "bg-slate-100 text-slate-700",
  중: "bg-sky-100 text-sky-700",
  중상: "bg-amber-100 text-amber-800",
  상: "bg-rose-100 text-rose-700",
};

export default async function ReviewStatusPage({ searchParams }: { searchParams?: { all?: string } }) {
  await requireRole("admin");
  const supabase = await createClient();
  const showConfirmed = searchParams?.all === "1";

  // 2026-09-29: 모두 1000줄씩 끝까지 읽는다(lib/supabase/fetchAll.ts). 전에는 한 번에 최대 1000줄만 와서, 미확정 문항이
  // 1000개를 넘으면 일부 시험이 이 화면에서 말없이 빠질 수 있었다.
  const [{ data: pendingExamsRaw }, { data: unconfirmedRaw, error: unconfErr }]: any[] = await Promise.all([
    fetchAllPages((a, b) => supabase.from("exams").select("id").eq("status", "검수대기").order("id").range(a, b)),
    fetchAllPages((a, b) =>
      supabase.from("item_explanations").select("exam_id").eq("review_confirmed", false).order("id").range(a, b)
    ),
  ]);

  if (unconfErr) {
    return (
      <div className="card border-red-300 bg-red-50 text-sm text-red-700 space-y-1">
        <h1 className="font-semibold">검토현황을 불러오지 못했습니다</h1>
        <p>
          데이터베이스 마이그레이션 <code>0016_review_status_confirm.sql</code>이 아직 적용되지 않은 것
          같습니다. Supabase SQL Editor에서 실행한 뒤 다시 열어 주세요. ({unconfErr.message})
        </p>
      </div>
    );
  }

  const examIds = [
    ...new Set([
      ...((pendingExamsRaw as any[]) ?? []).map((e) => e.id),
      ...((unconfirmedRaw as any[]) ?? []).map((r) => r.exam_id),
    ]),
  ];

  // #4: 과외선생님 해설·정답 수정 요청(대기) — 0017 적용 전이면 테이블이 없어 조용히 빈 목록.
  const { data: editReqRaw } = (await (supabase.from("tutor_edit_requests") as any)
    .select("id, exam_id, item_label, tutor_id, proposed_answer, proposed_solution, note, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true })) as any;
  const editReqs: any[] = editReqRaw ?? [];
  const editBlock = editReqs.length ? await renderEditRequests(supabase, editReqs) : null;

  if (examIds.length === 0) {
    return (
      <div className="space-y-4">
        {editBlock}
        <div className="card">
          <h1 className="text-lg font-semibold mb-2">검토현황</h1>
          <p className="text-sm text-slate-500">지금 검토 중이거나 정답 확정이 필요한 시험이 없습니다.</p>
        </div>
      </div>
    );
  }

  const [{ data: examsRaw }, { data: itemsRaw }, { data: keysRaw }, { data: reviewsRaw }, { data: jobsRaw }]: any[] =
    await Promise.all([
      // is_jeju·school_level: 검토 배정 순서(0019)를 이 화면에서도 보이게(2026-09-28). 열이 없으면 아래에서 다시 읽음.
      fetchAllIn(examIds, (ids, a, b) =>
        supabase.from("exams").select("id, code, name, status, is_jeju, school_level").in("id", ids).order("id").range(a, b)
      ),
      fetchAllIn(examIds, (ids, a, b) =>
        supabase
          .from("item_explanations")
          .select(
            "id, exam_id, item_label, answer_display, tutor_reviewed, claimed_by, claim_expires_at, review_confirmed, review_confirm_source, ai_answer_display, difficulty"
          )
          .in("exam_id", ids)
          .order("id")
          .range(a, b)
      ),
      fetchAllIn(examIds, (ids, a, b) =>
        supabase
          .from("answer_key")
          .select("exam_id, item_label, correct_answers, type, sort_order")
          .in("exam_id", ids)
          .order("id")
          .range(a, b)
      ),
      fetchAllIn(examIds, (ids, a, b) =>
        supabase
          .from("tutor_item_reviews")
          .select("id, item_explanation_id, tutor_id, kind, answer_display, image_path, needs_verification, verified, is_match, matches_primary_review_id, created_at, verify_claimed_by, verify_claim_expires_at")
          .in("exam_id", ids)
          .order("created_at", { ascending: true })
          .order("id")
          .range(a, b)
      ),
      fetchAllIn(examIds, (ids, a, b) =>
        supabase.from("exam_jobs").select("exam_id, flags:state->flags").in("exam_id", ids).order("exam_id").range(a, b)
      ),
    ]);

  let examRows: any[] = (examsRaw as any[]) ?? [];
  if (!examRows.length && examIds.length) {
    const { data } = await fetchAllIn(examIds, (ids, a, b) =>
      supabase.from("exams").select("id, code, name, status").in("id", ids).order("id").range(a, b)
    );
    examRows = data ?? [];
  }
  // 문항 잘라 보기 영역(좌표) 상태 — 0024 전이면 available=false라 패널이 안 보인다.
  const pendingIds = ((pendingExamsRaw as any[]) ?? []).map((e) => e.id);
  const locate = await getLocateSummary(supabase, pendingIds);
  const examNameById = new Map(examRows.map((e) => [e.id, e.name as string]));
  // 과외선생님 검토 배정과 같은 순서: 검수대기 → 제주 학교 → 고등 > 중등 > 그 밖 → 이름
  const levelRank = (l: string | null | undefined) => (l === "고" ? 0 : l === "중" ? 1 : 2);
  const exams = examRows.sort(
    (a, b) =>
      Number(b.status === "검수대기") - Number(a.status === "검수대기") ||
      Number(!!b.is_jeju) - Number(!!a.is_jeju) ||
      levelRank(a.school_level) - levelRank(b.school_level) ||
      String(a.name).localeCompare(String(b.name), "ko")
  );
  const items: Item[] = itemsRaw ?? [];
  const keyOf = new Map(((keysRaw as any[]) ?? []).map((k) => [`${k.exam_id}|${k.item_label}`, k]));
  const flagsByExam = new Map(((jobsRaw as any[]) ?? []).map((j) => [j.exam_id, (j.flags ?? {}) as Record<string, any>]));

  const reviews = (reviewsRaw as any[]) ?? [];
  const primaryByItem = new Map<string, any>();
  for (const r of reviews) if (r.kind === "primary") primaryByItem.set(r.item_explanation_id, r); // 가장 최근 것
  const verifyByPrimary = new Map<string, any>();
  for (const r of reviews) if (r.kind === "verify" && r.matches_primary_review_id) verifyByPrimary.set(r.matches_primary_review_id, r);

  const now = Date.now();
  // 2026-09-29: 지금 문항을 맡고 있는 과외선생님 이름도 보여 준다(검토 배정 + 사후검증 배정)
  const tutorIds = [
    ...new Set([
      ...reviews.map((r) => r.tutor_id),
      ...items.filter((it) => it.claimed_by).map((it) => it.claimed_by as string),
      ...reviews.filter((r) => r.verify_claimed_by).map((r) => r.verify_claimed_by as string),
    ]),
  ];
  const { data: profilesRaw } = tutorIds.length
    ? await fetchAllIn(tutorIds, (ids, a, b) =>
        supabase.from("profiles").select("id, email, display_name, cohort").in("id", ids).order("id").range(a, b)
      )
    : { data: [] };
  const emailById = new Map(((profilesRaw as any[]) ?? []).map((p) => [p.id, personLabel(p) || "과외선생님"]));
  let totalUnconfirmed = 0;
  let totalMismatch = 0;

  const examBlocks = exams.map((exam) => {
    const flags = flagsByExam.get(exam.id) ?? {};
    const rows = items
      .filter((it) => it.exam_id === exam.id)
      .map((it) => {
        const key = keyOf.get(`${exam.id}|${it.item_label}`);
        const primary = primaryByItem.get(it.id);
        const verify = primary ? verifyByPrimary.get(primary.id) : undefined;
        const match = primary && key ? tutorAnswerMatches(key.type, primary.answer_display, key.correct_answers) : null;
        const claimed = !!it.claimed_by && !!it.claim_expires_at && new Date(it.claim_expires_at).getTime() > now;
        let state: { label: string; cls: string };
        if (it.review_confirmed) {
          state = { label: "확정 · " + (SOURCE_LABEL[it.review_confirm_source ?? ""] ?? "확정"), cls: "bg-emerald-100 text-emerald-700" };
        } else if (primary) {
          state = match
            ? { label: "제출 · AI와 일치", cls: "bg-amber-100 text-amber-800" }
            : { label: "제출 · AI와 다름", cls: "bg-red-100 text-red-700" };
        } else if (claimed) {
          state = { label: `${emailById.get(it.claimed_by as string) ?? "과외선생님"} 풀이 중`, cls: "bg-sky-100 text-sky-700" };
        } else {
          state = { label: "검토 대기", cls: "bg-slate-100 text-slate-600" };
        }
        let verifyLabel = "—";
        if (primary?.needs_verification) {
          verifyLabel = !verify ? "검증 대기" : verify.is_match === true ? "검증 일치" : verify.is_match === false ? "검증 불일치" : "검증 판정 전";
          const vClaimed =
            !verify && primary.verify_claimed_by && primary.verify_claim_expires_at && new Date(primary.verify_claim_expires_at).getTime() > now;
          if (vClaimed) verifyLabel = `검증 중 · ${emailById.get(primary.verify_claimed_by) ?? "과외선생님"}`;
        }
        const initial = primary && key ? toKeyAnswer(key.type, primary.answer_display) : key?.correct_answers ?? "";
        return {
          it,
          key,
          primary,
          match,
          state,
          verifyLabel,
          conf: flags[it.item_label]?.c as string | undefined,
          initial,
          sort: typeof key?.sort_order === "number" ? key.sort_order : 9999,
        };
      })
      .sort((a, b) => a.sort - b.sort || a.it.item_label.localeCompare(b.it.item_label, "ko", { numeric: true }));

    const unconfirmed = rows.filter((r) => !r.it.review_confirmed);
    const submitted = rows.filter((r) => r.primary).length;
    const mismatch = unconfirmed.filter((r) => r.primary && r.match === false).length;
    const matchedPending = unconfirmed.filter((r) => r.primary && r.match === true).length;
    totalUnconfirmed += unconfirmed.length;
    totalMismatch += mismatch;
    return { exam, rows, unconfirmed: unconfirmed.length, submitted, mismatch, matchedPending };
  });

  return (
    <div className="space-y-4">
      {locate.available && (
        <LocatePanel
          missingItems={locate.missingItems}
          jobs={locate.jobs.map((j) => ({ ...j, examName: examNameById.get(j.examId) ?? "시험" }))}
        />
      )}
      {editBlock}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">검토현황</h1>
          <p className="text-sm text-slate-500">
            시험 {exams.length}개 · 미확정 {totalUnconfirmed}문항
            {totalMismatch > 0 && <span className="text-red-600"> · AI와 다른 제출 {totalMismatch}문항</span>}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            과외선생님 답이 정답표와 같으면 자동 확정되고, 시험의 모든 문항이 확정되면 시험이 자동으로 열립니다.
            &ldquo;이 정답으로 확정&rdquo;은 입력칸의 값을 정답표에 그대로 저장합니다(여러 정답은 | 로 구분).
            시험은 과외선생님에게 문항이 배정되는 순서(제주 학교 → 고등 → 중등)대로 보입니다. 제주 학교인데
            &ldquo;타 지역&rdquo;으로 표시된 시험은 시험 상세에서 &ldquo;제주도 내 학교 시험&rdquo;을 체크해 주세요.
          </p>
        </div>
        <Link href={showConfirmed ? "/admin/review-status" : "/admin/review-status?all=1"} className="text-sm link-accent">
          {showConfirmed ? "미확정 문항만 보기" : "확정된 문항도 보기"}
        </Link>
      </div>

      {examBlocks.map(({ exam, rows, unconfirmed, submitted, mismatch, matchedPending }) => {
        const visible = showConfirmed ? rows : rows.filter((r) => !r.it.review_confirmed);
        return (
          <div key={exam.id} className="card space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-medium">
                  <Link href={`/exams/${encodeURIComponent(exam.code)}`} className="hover:underline">
                    {exam.name}
                  </Link>{" "}
                  <span className="text-slate-400 text-sm font-normal">({exam.code})</span>{" "}
                  <span
                    className={
                      "badge " + (exam.status === "검수대기" ? "bg-amber-100 text-amber-700" : exam.status === "열림" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600")
                    }
                  >
                    {exam.status}
                  </span>{" "}
                  {"is_jeju" in exam && (
                    <span className={"badge " + (exam.is_jeju ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-500")}>
                      {exam.is_jeju ? "제주" : "타 지역"}
                      {exam.school_level ? ` · ${exam.school_level === "고" ? "고등" : exam.school_level === "중" ? "중등" : exam.school_level}` : ""}
                    </span>
                  )}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  확정 {rows.length - unconfirmed}/{rows.length} · 과외 제출 {submitted}/{rows.length}
                  {mismatch > 0 && <span className="text-red-600"> · AI와 다름 {mismatch}</span>}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ConfirmMatchedButton examId={exam.id} count={matchedPending} />
                {exam.status === "검수대기" && <ApproveReviewButton code={exam.code} />}
              </div>
            </div>

            {visible.length === 0 ? (
              <p className="text-sm text-slate-500">모든 문항이 확정됐습니다.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-200">
                      <th className="py-1.5 pr-2 font-medium">번호</th>
                      <th className="py-1.5 pr-2 font-medium">난이도</th>
                      <th className="py-1.5 pr-2 font-medium">정답표</th>
                      <th className="py-1.5 pr-2 font-medium">AI 확신</th>
                      <th className="py-1.5 pr-2 font-medium">과외 제출</th>
                      <th className="py-1.5 pr-2 font-medium">사후검증</th>
                      <th className="py-1.5 pr-2 font-medium">상태</th>
                      <th className="py-1.5 font-medium">확정</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r) => (
                      <tr key={r.it.id} className={"border-b border-slate-100 align-top " + (r.it.review_confirmed ? "opacity-60" : "")}>
                        <td className="py-2 pr-2 whitespace-nowrap font-medium">
                          <Link href={`/admin/review-status/item/${r.it.id}`} className="link-accent" title="문제 보며 직접 풀기">
                            {r.it.item_label}
                          </Link>
                        </td>
                        <td className="py-2 pr-2 whitespace-nowrap">
                          {r.it.difficulty ? (
                            <span
                              className={"badge " + (DIFF_CLS[r.it.difficulty] ?? "bg-slate-100 text-slate-600")}
                              title={`과외 적립 ${r.it.difficulty === "중상" || r.it.difficulty === "상" ? 2 : 1}P`}
                            >
                              {r.it.difficulty}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-2 pr-2 whitespace-nowrap">
                          {r.key?.correct_answers ?? <span className="text-red-600">없음</span>}
                          {r.key?.type && <span className="text-xs text-slate-400 ml-1">{r.key.type}</span>}
                        </td>
                        <td className="py-2 pr-2 whitespace-nowrap">
                          <span className={r.conf === "low" || r.conf === "fail" ? "text-red-600" : "text-slate-600"}>
                            {r.conf ? CONF_LABEL[r.conf] ?? r.conf : "—"}
                          </span>
                        </td>
                        <td className="py-2 pr-2">
                          {r.primary ? (
                            <div>
                              <span className="font-medium">{r.primary.answer_display}</span>
                              <div className="text-xs text-slate-500">
                                {emailById.get(r.primary.tutor_id) ?? "과외선생님"}
                                {r.primary.image_path && (
                                  <>
                                    {" · "}
                                    <a href={`/admin/tutor-disputes/photo/${r.primary.id}`} target="_blank" rel="noreferrer" className="link-accent">
                                      사진
                                    </a>
                                  </>
                                )}
                              </div>
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-2 pr-2 whitespace-nowrap text-xs">
                          <span className={r.verifyLabel === "검증 불일치" ? "text-red-600" : "text-slate-600"}>{r.verifyLabel}</span>
                        </td>
                        <td className="py-2 pr-2 whitespace-nowrap">
                          <span className={"badge " + r.state.cls}>{r.state.label}</span>
                        </td>
                        <td className="py-2">
                          {r.it.review_confirmed ? (
                            <Link href={`/admin/review-status/item/${r.it.id}`} className="text-xs link-accent">
                              해설 보기·고치기
                            </Link>
                          ) : (
                            <div className="space-y-1">
                              <ConfirmItemControl itemId={r.it.id} initialAnswer={r.initial} showKeepAi={!!r.primary && r.match === false} />
                              <Link href={`/admin/review-status/item/${r.it.id}`} className="text-xs link-accent">
                                문제 보며 직접 풀기 →
                              </Link>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** #4 과외선생님 수정 요청 목록(대기). */
async function renderEditRequests(supabase: any, reqs: any[]) {
  const examIds = [...new Set(reqs.map((r) => r.exam_id))];
  const tutorIds = [...new Set(reqs.map((r) => r.tutor_id))];
  const [{ data: examsRaw }, { data: keysRaw }, { data: explRaw }, { data: profRaw }]: any[] = await Promise.all([
    supabase.from("exams").select("id, code, name").in("id", examIds),
    supabase.from("answer_key").select("exam_id, item_label, correct_answers, type").in("exam_id", examIds),
    supabase.from("item_explanations").select("exam_id, item_label, solution").in("exam_id", examIds),
    supabase.from("profiles").select("id, email").in("id", tutorIds),
  ]);
  const examBy = new Map(((examsRaw as any[]) ?? []).map((e) => [e.id, e]));
  const keyBy = new Map(((keysRaw as any[]) ?? []).map((k) => [`${k.exam_id}|${k.item_label}`, k]));
  const explBy = new Map(((explRaw as any[]) ?? []).map((e) => [`${e.exam_id}|${e.item_label}`, e]));
  const emailBy = new Map(((profRaw as any[]) ?? []).map((p) => [p.id, p.email as string]));

  return (
    <div className="card border-sky-200 space-y-3">
      <div>
        <h2 className="font-medium">과외선생님 수정 요청 ({reqs.length})</h2>
        <p className="text-xs text-slate-500">
          구매한 시험에서 과외선생님이 올린 정답·해설 수정 요청입니다. 채택하면 정답표·해설에 반영되고, 정답이 바뀌면 이미
          제출된 답안을 다시 채점합니다.
        </p>
      </div>
      <div className="divide-y divide-slate-100">
        {reqs.map((r) => {
          const exam = examBy.get(r.exam_id);
          const key = keyBy.get(`${r.exam_id}|${r.item_label}`);
          const expl = explBy.get(`${r.exam_id}|${r.item_label}`);
          const initial = r.proposed_answer && key ? toKeyAnswer(key.type, r.proposed_answer) : "";
          return (
            <div key={r.id} className="py-3 grid gap-3 md:grid-cols-[1fr_1fr_auto] text-sm">
              <div className="space-y-1">
                <p className="font-medium">
                  {exam ? (
                    <Link href={`/exams/${encodeURIComponent(exam.code)}`} className="hover:underline">
                      {exam.name}
                    </Link>
                  ) : (
                    "시험"
                  )}{" "}
                  · {r.item_label}번
                </p>
                <p className="text-xs text-slate-500">
                  {emailBy.get(r.tutor_id) ?? "과외선생님"} · {new Date(r.created_at).toLocaleString("ko-KR")}
                </p>
                <p>
                  현재 정답 <span className="font-medium">{key?.correct_answers ?? "—"}</span>
                  {r.proposed_answer && (
                    <>
                      {" "}→ 제안 <span className="font-medium text-sky-700">{r.proposed_answer}</span>
                    </>
                  )}
                </p>
                {r.note && <p className="text-slate-600">메모: {r.note}</p>}
              </div>
              <div className="space-y-1">
                {r.proposed_solution ? (
                  <details>
                    <summary className="cursor-pointer text-xs text-slate-500">제안 해설 / 현재 해설 비교</summary>
                    <p className="text-xs text-slate-500 mt-1">제안</p>
                    <div className="bg-sky-50 rounded px-2 py-1 whitespace-pre-wrap max-h-48 overflow-y-auto">{r.proposed_solution}</div>
                    <p className="text-xs text-slate-500 mt-1">현재</p>
                    <div className="bg-slate-50 rounded px-2 py-1 whitespace-pre-wrap max-h-48 overflow-y-auto">{expl?.solution || "(없음)"}</div>
                  </details>
                ) : (
                  <p className="text-xs text-slate-400">해설 수정 제안 없음</p>
                )}
              </div>
              <EditRequestControl requestId={r.id} initialAnswer={initial} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
