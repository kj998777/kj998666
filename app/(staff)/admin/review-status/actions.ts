"use server";

import { latexToPlain } from "@/lib/grading";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { openExamIfAllConfirmed, tutorAnswerMatches } from "@/lib/review/confirm";
import { regradeExam } from "@/lib/review/regrade";
import { gradeGoldAttempt, judgeItemReviews } from "@/lib/review/majority";

/** 0037: 원장님이 정한 정답으로 그 문항 선생님 제출들의 정답 여부를 기록(정답률·등급). 실패해도 확정은 그대로. */
async function judgeAfterAdmin(itemId: string) {
  try {
    await judgeItemReviews(createAdminClient(), itemId, "admin");
  } catch (e) {
    console.error("judgeItemReviews failed", e);
  }
}

// #3 관리자 검토현황 — 문항별 정답 확정. 확정되면 그 문항은 과외선생님 검토 큐에서도 빠지고
// (tutor_reviewed=true), 시험의 모든 문항이 확정되면 검수대기 시험이 자동으로 열린다.

type Result = { ok: boolean; msg?: string; examOpened?: boolean };

async function loadItem(supabase: any, itemId: string) {
  const { data: ie } = (await supabase
    .from("item_explanations")
    .select("id, exam_id, item_label, ai_answer_display, ai_solution")
    .eq("id", itemId)
    .maybeSingle()) as any;
  if (!ie) return null;
  const [{ data: key }, { data: exam }] = await Promise.all([
    supabase
      .from("answer_key")
      .select("id, correct_answers, type")
      .eq("exam_id", ie.exam_id)
      .eq("item_label", ie.item_label)
      .maybeSingle(),
    supabase.from("exams").select("code").eq("id", ie.exam_id).maybeSingle(),
  ]);
  return { ie, key: key as any, code: (exam as any)?.code as string | undefined };
}

async function markConfirmed(supabase: any, itemIds: string[], userId: string, source: "admin" | "auto_match") {
  const patch: Record<string, unknown> = {
    review_confirmed: true,
    review_confirm_source: source,
    review_confirmed_by: userId,
    review_confirmed_at: new Date().toISOString(),
    // 확정된 문항은 과외선생님 검토 큐에서 뺀다(아직 아무도 안 풀었어도).
    tutor_reviewed: true,
    review_stage: null, // 0037: 다수결 대기·원장님 판정 표시도 끝
    claimed_by: null,
    claim_expires_at: null,
  };
  let { error } = await (supabase.from("item_explanations") as any).update(patch).in("id", itemIds);
  if (error && /review_stage/.test(String(error.message))) {
    // 0037 SQL 전이면 열이 없다 — 그 열만 빼고 다시
    delete patch.review_stage;
    ({ error } = await (supabase.from("item_explanations") as any).update(patch).in("id", itemIds));
  }
  return error;
}

function refresh(code?: string) {
  revalidatePath("/admin/review-status");
  revalidatePath("/exams");
  if (code) revalidatePath(`/exams/${code}`);
}

/** 입력한 정답으로 확정. 정답표와 다르면 정답표(answer_key)도 이 값으로 바꾼다. */
export async function confirmItem(itemId: string, answer: string): Promise<Result> {
  const { userId } = await requireRole("admin");
  const value = answer.trim();
  if (!value) return { ok: false, msg: "정답을 입력해 주세요." };
  if (value.length > 200) return { ok: false, msg: "정답이 너무 깁니다." };

  const supabase = await createClient();
  const loaded = await loadItem(supabase, itemId);
  if (!loaded) return { ok: false, msg: "문항을 찾을 수 없습니다." };
  const { ie, key, code } = loaded;

  let keyChanged = false;
  if (key) {
    if (key.correct_answers !== value) {
      const { error } = await (supabase.from("answer_key") as any).update({ correct_answers: value }).eq("id", key.id);
      if (error) return { ok: false, msg: "정답표를 고치지 못했습니다: " + error.message };
      keyChanged = true;
    }
  } else {
    return { ok: false, msg: "이 문항의 정답표 줄이 없습니다. 시험 상세에서 먼저 정답을 추가해 주세요." };
  }

  const err = await markConfirmed(supabase, [ie.id], userId, "admin");
  if (err) return { ok: false, msg: "확정하지 못했습니다: " + err.message };

  // 정답이 바뀌었으면 이미 들어온 제출(있다면)을 새 정답으로 다시 채점
  if (keyChanged) await regradeExam(createAdminClient(), ie.exam_id);
  await judgeAfterAdmin(ie.id);

  const examOpened = await openExamIfAllConfirmed(supabase, ie.exam_id);
  refresh(code);
  return { ok: true, examOpened };
}

/**
 * 과외선생님 답이 틀렸다고 보고 AI 정답을 유지 — 정답표는 그대로 두고, 과외선생님 제출로 덮어써진
 * 해설(정답 표시·풀이)을 AI 원본으로 되돌린 뒤 확정한다(0016 이전 제출이라 원본이 없으면 해설은 그대로).
 */
export async function keepAiAnswer(itemId: string): Promise<Result> {
  const { userId } = await requireRole("admin");
  const supabase = await createClient();
  const loaded = await loadItem(supabase, itemId);
  if (!loaded) return { ok: false, msg: "문항을 찾을 수 없습니다." };
  const { ie, code } = loaded;

  if (ie.ai_answer_display != null || ie.ai_solution != null) {
    const patch: Record<string, string> = { updated_at: new Date().toISOString() };
    if (ie.ai_answer_display != null) patch.answer_display = ie.ai_answer_display;
    if (ie.ai_solution != null) patch.solution = ie.ai_solution;
    const { error } = await (supabase.from("item_explanations") as any).update(patch).eq("id", ie.id);
    if (error) return { ok: false, msg: "AI 해설로 되돌리지 못했습니다: " + error.message };
  }

  const err = await markConfirmed(supabase, [ie.id], userId, "admin");
  if (err) return { ok: false, msg: "확정하지 못했습니다: " + err.message };
  await judgeAfterAdmin(ie.id);

  const examOpened = await openExamIfAllConfirmed(supabase, ie.exam_id);
  refresh(code);
  return { ok: true, examOpened };
}

/** 과외선생님 답이 정답표와 같은데 아직 확정 안 된 문항(0016 이전 제출분 등)을 한 번에 확정. */
export async function confirmMatchedItems(examId: string): Promise<Result & { count?: number }> {
  const { userId } = await requireRole("admin");
  const supabase = await createClient();

  const [{ data: items }, { data: keys }, { data: exam }] = await Promise.all([
    supabase
      .from("item_explanations")
      .select("id, item_label, answer_display, tutor_reviewed, review_confirmed")
      .eq("exam_id", examId)
      .eq("review_confirmed", false)
      .eq("tutor_reviewed", true),
    supabase.from("answer_key").select("item_label, correct_answers, type").eq("exam_id", examId),
    supabase.from("exams").select("code").eq("id", examId).maybeSingle(),
  ]);
  const keyByLabel = new Map(((keys as any[]) ?? []).map((k) => [k.item_label, k]));
  const ids = ((items as any[]) ?? [])
    .filter((it) => {
      const k = keyByLabel.get(it.item_label);
      return k && tutorAnswerMatches(k.type, it.answer_display, k.correct_answers);
    })
    .map((it) => it.id);

  if (ids.length === 0) return { ok: true, count: 0 };
  const err = await markConfirmed(supabase, ids, userId, "auto_match");
  if (err) return { ok: false, msg: "확정하지 못했습니다: " + err.message };

  const examOpened = await openExamIfAllConfirmed(supabase, examId);
  refresh((exam as any)?.code);
  return { ok: true, count: ids.length, examOpened };
}

// -------------------------------------------------------------------------
// #4: 과외선생님 해설·정답 수정 요청 — 채택/거절
// -------------------------------------------------------------------------

/**
 * 수정 요청 채택. answer(관리자가 입력칸에서 최종 확인한 정답표 값)가 지금 정답과 다르면 정답표를 바꾸고
 * 기존 제출을 다시 채점한다. 요청에 해설이 있으면 해설도 바꾼다.
 */
export async function acceptEditRequest(requestId: string, answer: string): Promise<Result & { regraded?: number; reward?: number }> {
  const { userId } = await requireRole("admin");
  const supabase = await createClient();
  const { data: req } = (await (supabase.from("tutor_edit_requests") as any)
    .select("id, exam_id, item_label, tutor_id, proposed_answer, proposed_solution, status")
    .eq("id", requestId)
    .maybeSingle()) as any;
  if (!req) return { ok: false, msg: "요청을 찾을 수 없습니다." };
  if (req.status !== "pending") return { ok: false, msg: "이미 처리한 요청입니다." };

  const [{ data: key }, { data: exam }]: any[] = await Promise.all([
    supabase.from("answer_key").select("id, correct_answers").eq("exam_id", req.exam_id).eq("item_label", req.item_label).maybeSingle(),
    supabase.from("exams").select("code").eq("id", req.exam_id).maybeSingle(),
  ]);
  if (!key) return { ok: false, msg: "정답표에서 이 문항을 찾을 수 없습니다." };

  const value = answer.trim();
  let keyChanged = false;
  if (value && value !== key.correct_answers) {
    if (value.length > 200) return { ok: false, msg: "정답이 너무 깁니다." };
    const { error } = await (supabase.from("answer_key") as any).update({ correct_answers: value }).eq("id", key.id);
    if (error) return { ok: false, msg: "정답표를 고치지 못했습니다: " + error.message };
    keyChanged = true;
  }

  const patch: Record<string, string> = {};
  if (req.proposed_solution) patch.solution = req.proposed_solution;
  if (req.proposed_answer && keyChanged) patch.answer_display = req.proposed_answer;
  if (Object.keys(patch).length) {
    patch.updated_at = new Date().toISOString();
    const { error } = await (supabase.from("item_explanations") as any)
      .update(patch)
      .eq("exam_id", req.exam_id)
      .eq("item_label", req.item_label);
    if (error) return { ok: false, msg: "해설을 고치지 못했습니다: " + error.message };
  }

  const { error: uErr } = await (supabase.from("tutor_edit_requests") as any)
    .update({ status: "accepted", resolved_by: userId, resolved_at: new Date().toISOString() })
    .eq("id", requestId);
  if (uErr) return { ok: false, msg: "요청 상태를 바꾸지 못했습니다: " + uErr.message };

  const regraded = keyChanged ? await regradeExam(createAdminClient(), req.exam_id) : 0;

  // 0037 이의제기 보상·판정: 정답이 바뀌면 +3P(해설만 반영이면 +1P), 그 문항 선생님 제출·정답 아는 문항 채점을 새 정답으로 다시 기록
  let reward = 0;
  try {
    const admin = createAdminClient() as any;
    reward = keyChanged ? 3 : req.proposed_solution ? 1 : 0;
    if (reward && req.tutor_id) {
      const { error: lErr } = await admin.from("tutor_points_ledger").insert({
        tutor_id: req.tutor_id,
        delta: reward,
        reason: "dispute_reward",
        ref_exam_id: req.exam_id,
        ref_item_label: req.item_label,
      });
      if (!lErr) {
        const { data: st } = await admin.from("tutor_stats").select("points_balance").eq("tutor_id", req.tutor_id).maybeSingle();
        if (st) await admin.from("tutor_stats").update({ points_balance: Number(st.points_balance) + reward }).eq("tutor_id", req.tutor_id);
      } else reward = 0;
    }
    if (keyChanged) {
      const { data: ieRow } = await admin.from("item_explanations").select("id").eq("exam_id", req.exam_id).eq("item_label", req.item_label).maybeSingle();
      if (ieRow) {
        await judgeItemReviews(admin, ieRow.id, "dispute");
        const { data: golds } = await admin.from("tutor_gold_attempts").select("id").eq("item_explanation_id", ieRow.id).not("submitted_at", "is", null);
        for (const g of (golds as any[]) ?? []) await gradeGoldAttempt(admin, g.id);
      }
    }
  } catch (e) {
    console.error("dispute reward/judge failed", e);
  }
  refresh(exam?.code);
  return { ok: true, regraded, reward };
}

export async function rejectEditRequest(requestId: string): Promise<Result> {
  const { userId } = await requireRole("admin");
  const supabase = await createClient();
  const { error } = await (supabase.from("tutor_edit_requests") as any)
    .update({ status: "rejected", resolved_by: userId, resolved_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("status", "pending");
  if (error) return { ok: false, msg: "처리하지 못했습니다: " + error.message };
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 문항 영역(잘라 보기 좌표) AI로 다시 찾기 — 2026-09-28 원장님 결정. lib/ai/locate.ts 참고.
// 작업 테이블(item_locate_jobs)은 서비스롤로만 쓰므로 관리자 확인 뒤 admin 클라이언트로 진행한다.
// ---------------------------------------------------------------------------

/**
 * 시험(2026-10-05부터 열린·닫힌 시험 포함) 중 좌표 없는 문항이 있는 시험마다 영역 찾기 작업을 걸어 둔다(곧바로 끝남). 실제 진행은 화면이
 * locate-tick 라우트를 부르거나 크론이 돌 때 이루어진다 — 버튼이 수십 초씩 붙잡혀 있지 않도록(2026-09-29).
 */
export async function startLocateItems(): Promise<Result & { queued?: number }> {
  await requireRole("admin");
  const admin = createAdminClient();
  const { enqueueMissingLocateJobs } = await import("@/lib/ai/locate");
  const { queued, missingItems } = await enqueueMissingLocateJobs(admin);
  if (!missingItems) return { ok: true, msg: "좌표가 없는 문항이 없습니다.", queued: 0 };
  revalidatePath("/admin/review-status");
  revalidatePath("/admin/ai");
  return {
    ok: true,
    queued,
    msg: queued
      ? `시험 ${queued}개의 문항 영역 찾기를 시작했습니다. AI 일괄 처리라 보통 수 분(붐비면 1시간 가까이) 걸리고, 이 화면을 닫아도 계속 진행됩니다.`
      : "이미 진행 중입니다. 잠시 뒤 새로고침해 주세요.",
  };
}

/** 2026-09-29: 디지털 조판본으로 바꾼 시험의 옛(스캔본 기준) 문항 좌표를 지우고 새 PDF에서 AI로 다시 찾게 한다. */
export async function fixDigitizedLocations(): Promise<Result & { exams?: number; items?: number }> {
  await requireRole("admin");
  const admin = createAdminClient();
  const { resetStaleDigitized } = await import("@/lib/ai/locate");
  const r = await resetStaleDigitized(admin);
  revalidatePath("/admin/review-status");
  revalidatePath("/admin/ai");
  return {
    ok: true,
    ...r,
    msg: r.exams
      ? `시험 ${r.exams}개(문항 ${r.items}개)의 옛 좌표를 지우고 새 PDF에서 영역 찾기를 시작했습니다. 보통 수 분 걸립니다.`
      : "바로잡을 시험이 없습니다.",
  };
}

/** 2026-09-29: 영역 찾기 "완료" 문항까지 위치를 전부 다시 찾기(스캔·디지털 조판 시험만 — 글자 PDF는 화면이 직접 찾음). */
export async function recheckAllLocations(): Promise<Result & { exams?: number; items?: number }> {
  await requireRole("admin");
  const admin = createAdminClient();
  const { resetForRecheck } = await import("@/lib/ai/locate");
  const r = await resetForRecheck(admin);
  revalidatePath("/admin/review-status");
  revalidatePath("/admin/ai");
  return {
    ok: true,
    ...r,
    msg: r.exams
      ? `시험 ${r.exams}개(문항 ${r.items}개)의 위치를 지우고 다시 찾기 시작했습니다. 이번에는 앞뒤 문항 자리로 경계를 맞춥니다. 보통 수 분 걸립니다.`
      : "다시 찾을 시험이 없습니다.",
  };
}

/**
 * 2026-09-29 원장님 요청: 검토현황에서 관리자가 문제를 보며 직접 정답·해설을 등록하고 확정한다.
 * key = 정답표에 넣을 값(채점용, 여러 정답은 |), display = 해설에 보이는 정답, solution = 풀이.
 * 처음 덮어쓸 때 AI 원본을 ai_* 열에 남겨 둔다("AI 정답 유지"로 되돌릴 수 있게). 정답이 바뀌면 제출을 다시 채점한다.
 */
export async function adminSolveItem(
  itemId: string,
  input: { key: string; display: string; solution: string }
): Promise<Result & { regraded?: number }> {
  const { userId } = await requireRole("admin");
  // 2026-09-29: 채점용 답도 수식 버튼으로 적을 수 있다 — 정답표에는 채점·표시가 깔끔한 글 모양(3/4, √3/2)으로 저장하고,
  // 정답 표시(해설용)를 비워 두면 적은 수식 그대로 쓴다.
  const rawKey = String(input?.key ?? "").trim();
  const key = latexToPlain(rawKey).trim();
  const display = String(input?.display ?? "").trim() || rawKey;
  const solution = String(input?.solution ?? "").trim();
  if (!key) return { ok: false, msg: "정답(정답표)을 입력해 주세요." };
  if (key.length > 200) return { ok: false, msg: "정답이 너무 깁니다(200자 이하)." };
  if (display.length > 500) return { ok: false, msg: "정답 표시가 너무 깁니다(500자 이하)." };
  if (solution.length > 20000) return { ok: false, msg: "풀이가 너무 깁니다." };

  const supabase = await createClient();
  const { data: ie } = (await supabase
    .from("item_explanations")
    .select("id, exam_id, item_label, answer_display, solution, ai_answer_display, ai_solution")
    .eq("id", itemId)
    .maybeSingle()) as any;
  if (!ie) return { ok: false, msg: "문항을 찾을 수 없습니다." };
  const [{ data: keyRow }, { data: exam }]: any[] = await Promise.all([
    supabase.from("answer_key").select("id, correct_answers").eq("exam_id", ie.exam_id).eq("item_label", ie.item_label).maybeSingle(),
    supabase.from("exams").select("code").eq("id", ie.exam_id).maybeSingle(),
  ]);
  if (!keyRow) return { ok: false, msg: "이 문항의 정답표 줄이 없습니다. 시험 상세에서 먼저 정답을 추가해 주세요." };

  let keyChanged = false;
  if (keyRow.correct_answers !== key) {
    const { error } = await (supabase.from("answer_key") as any).update({ correct_answers: key }).eq("id", keyRow.id);
    if (error) return { ok: false, msg: "정답표를 고치지 못했습니다: " + error.message };
    keyChanged = true;
  }

  const patch: Record<string, unknown> = { answer_display: display, solution, updated_at: new Date().toISOString() };
  if (ie.ai_answer_display == null) patch.ai_answer_display = ie.answer_display ?? "";
  if (ie.ai_solution == null) patch.ai_solution = ie.solution ?? "";
  const { error: eErr } = await (supabase.from("item_explanations") as any).update(patch).eq("id", ie.id);
  if (eErr) return { ok: false, msg: "해설을 저장하지 못했습니다: " + eErr.message };

  const err = await markConfirmed(supabase, [ie.id], userId, "admin");
  if (err) return { ok: false, msg: "확정하지 못했습니다: " + err.message };

  const regraded = keyChanged ? await regradeExam(createAdminClient(), ie.exam_id) : 0;
  await judgeAfterAdmin(ie.id);
  const examOpened = await openExamIfAllConfirmed(supabase, ie.exam_id);
  refresh(exam?.code);
  return { ok: true, regraded, examOpened };
}

// ---------------------------------------------------------------------------
// 2026-09-29 원장님 요청: 관리자도 문항 화면에서 풀이 사진을 올린다. 과외선생님 사진과 같은 비공개 버킷
// (tutor-review-photos, 0005)의 admin/<문항 id>/ 아래에 저장하고, 보기는 관리자 전용 라우트로만 한다.
// ---------------------------------------------------------------------------
const ADMIN_PHOTO_BUCKET = "tutor-review-photos";
const ADMIN_PHOTO_MAX = 4 * 1024 * 1024; // 브라우저에서 줄여서 보내므로 넉넉함(서버 요청 한도 약 4.5MB)

export async function adminUploadItemPhoto(itemId: string, form: FormData): Promise<Result> {
  await requireRole("admin");
  if (!/^[0-9a-f-]{36}$/i.test(itemId)) return { ok: false, msg: "문항을 찾을 수 없습니다." };
  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0) return { ok: false, msg: "사진을 골라 주세요." };
  if (!file.type.startsWith("image/")) return { ok: false, msg: "이미지 파일만 올릴 수 있습니다." };
  if (file.size > ADMIN_PHOTO_MAX) return { ok: false, msg: "사진 용량이 너무 큽니다(4MB 이하)." };
  const ext = (file.type.split("/")[1] || "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "jpg";
  const path = `admin/${itemId}/${Date.now()}.${ext}`;
  const admin = createAdminClient();
  const { error } = await admin.storage
    .from(ADMIN_PHOTO_BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (error) return { ok: false, msg: "사진을 올리지 못했습니다: " + error.message };
  revalidatePath(`/admin/review-status/item/${itemId}`);
  return { ok: true };
}

export async function adminDeleteItemPhoto(itemId: string, name: string): Promise<Result> {
  await requireRole("admin");
  if (!/^[0-9a-f-]{36}$/i.test(itemId) || !/^[0-9]+\.[a-z0-9]{1,5}$/i.test(name)) return { ok: false, msg: "잘못된 요청입니다." };
  const admin = createAdminClient();
  const { error } = await admin.storage.from(ADMIN_PHOTO_BUCKET).remove([`admin/${itemId}/${name}`]);
  if (error) return { ok: false, msg: "지우지 못했습니다: " + error.message };
  revalidatePath(`/admin/review-status/item/${itemId}`);
  return { ok: true };
}
