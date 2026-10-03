"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { finalizePdfUpload } from "@/lib/ai/pdf";
import { applyNewPdfLocations } from "@/lib/ai/relocate";
import { createAdminClient } from "@/lib/supabase/admin";
import { startExamAiJob, cancelExamAiJob, tickExamJob } from "@/lib/ai/pipeline";
import { startDigitizeJob } from "@/lib/ai/digitize";
import { tagJejuSchool } from "@/lib/exams/tagJeju";
import { guessFolder, mergeFolder } from "@/lib/exams/guessFolder";
import { getJob, isActiveStage, setJob } from "@/lib/ai/job";
import type { SchoolLevel } from "@/lib/supabase/types";

// AI 자동 처리(시험지 업로드 → 문항 추출 → 풀이 → 검수) 관련 서버 액션들.
// 비용이 드는 작업이라 전부 admin 전용으로 막는다(화면에서도 admin에게만 버튼을 보여줌 — 이중 방어).
//
// #2(2026-09-28): PDF 원본 바이트는 이제 서버 액션이 아니라 브라우저가 Supabase Storage에 곧바로
// 올린다(lib/supabase/uploadPdf.ts) — Vercel 서버리스 함수의 요청 본문 크기 제한(약 4.5MB, Next.js
// 설정으로는 못 늘림)을 우회해 50MB까지 지원하기 위함. 그래서 아래 액션들은 더 이상 FormData로 PDF
// 바이트를 직접 받지 않고, "이미 Storage에 올라온 파일"의 뒷정리(쪽수 세기·exam_pdf_meta 기록·AI
// 자동 처리/디지털화 시작)만 한다 — 새 시험을 만드는 흐름은 createExamRow(행만 먼저 생성) →
// (브라우저가 Storage에 직접 업로드) → finalizeAiExamUpload(뒷정리) 세 단계로 나뉜다.

async function getExamByCode(code: string) {
  const supabase = await createClient();
  const { data } = (await supabase.from("exams").select("*").eq("code", code).single()) as any;
  return data;
}

function schoolLevelField(formData: FormData): SchoolLevel | null {
  const v = String(formData.get("school_level") ?? "").trim();
  return v === "초" || v === "중" || v === "고" ? v : null;
}

function folderFields(formData: FormData) {
  const year = String(formData.get("folder_year") ?? "").trim();
  const gradeRaw = String(formData.get("folder_grade") ?? "").trim();
  const termRaw = String(formData.get("folder_term") ?? "").trim();
  const kind = String(formData.get("folder_kind") ?? "").trim();
  return {
    folder_year: year || null,
    folder_grade: gradeRaw ? Number(gradeRaw) : null,
    folder_term: termRaw ? Number(termRaw) : null,
    folder_kind: (kind || null) as "중간" | "기말" | "기타" | null,
  };
}

type CreateExamRowResult = { ok: true; id: string; code: string } | { ok: false; msg: string };

/**
* 새 시험 "행"만 먼저 만든다(PDF는 아직 없음). 예전에는 이 함수가 PDF 바이트까지 같이 FormData로
* 받아 저장했지만, #2(2026-09-28)부터는 PDF를 브라우저가 Supabase Storage에 곧바로 올리는 구조로
* 바뀌어서(위 파일 상단 설명 참고), 이 함수가 돌려준 id 앞으로 브라우저가 먼저 PDF를 올린 뒤
* finalizeAiExamUpload를 불러 마무리하는 순서로 나뉘었다. `CreateAiExamForm`(시험 1개짜리 폼)과
* `CreateAiExamBatchForm`(여러 개 한꺼번에, 파일마다 이 함수를 순서대로 호출)이 함께 쓴다.
*/
export async function createExamRow(formData: FormData): Promise<CreateExamRowResult> {
  const { userId } = await requireRole("admin");

  // 한글을 표준형(NFC)으로 — 맥 파일 이름의 분해형(NFD)이면 글자 검색·제주 판정이 안 된다(2026-09-29)
  const code = String(formData.get("code") ?? "").normalize("NFC").trim();
  const name = String(formData.get("name") ?? "").normalize("NFC").trim();
  if (!code) return { ok: false, msg: "시험 코드를 입력해 주세요." };
  if (!name) return { ok: false, msg: "시험 이름을 입력해 주세요." };

  const supabase = await createClient();
  // 2026-10-03: 폴더(학교급·연도·학년·학기·구분)를 비워 두면 시험 이름(=파일 이름)·코드에서 읽어 자동으로 채운다
  // (lib/exams/guessFolder.ts). 화면에서 고른 값이 있으면 그쪽이 우선.
  const folder = mergeFolder({ school_level: schoolLevelField(formData), ...folderFields(formData) }, guessFolder(name, code));
  const { data: exam, error } = (await supabase
    .from("exams")
    .insert({ code, name, status: "닫힘", created_by: userId, ...folder } as any)
    .select("id, code")
    .single()) as any;
  if (error) {
    const msg = error.code === "23505" ? "이미 사용 중인 시험 코드입니다." : "만들지 못했습니다: " + error.message;
    return { ok: false, msg };
  }
  // 이름으로 제주 학교 여부·학교급 자동 표시(검토 배정 우선순위용)
  await tagJejuSchool(supabase, exam.id, name, folder.school_level);
  return { ok: true, id: exam.id, code: exam.code };
}

type FinalizeAiExamResult = { ok: true; aiErr?: string };

/**
* createExamRow로 만든 시험에, 브라우저가 Storage로 방금 직접 올린 PDF를 연결하고 AI 자동 처리를
* 시작한다(스캔본으로 표시했으면 디지털화도 같이 시작). `CreateAiExamForm`/`CreateAiExamBatchForm`이
* PDF 업로드가 끝난 뒤 마지막 단계로 부른다. 시험 행은 이미 만들어져 있으므로, 이 단계에서 PDF
* 저장이나 AI 시작이 실패해도 항상 ok:true를 돌려주고(시험 상세 화면으로 이동은 계속 가능),
* 실패 사유는 aiErr로만 알려준다(상세 화면에서 다시 시도할 수 있음).
*/
export async function finalizeAiExamUpload(
  code: string,
  opts: { isScanned: boolean; startDigitize: boolean }
): Promise<FinalizeAiExamResult> {
  const { userId } = await requireRole("admin");
  const exam = await getExamByCode(code);
  if (!exam) return { ok: true, aiErr: "시험을 찾을 수 없습니다." };

  const supabase = await createClient();
  const errs: string[] = [];
  try {
    await finalizePdfUpload(supabase, exam.id, { isScanned: opts.isScanned, uploadedBy: userId });
    const r = await startExamAiJob(supabase, exam.id);
    if (!r.ok) errs.push(r.msg);
    if (opts.startDigitize) {
      const dr = await startDigitizeJob(supabase, exam.id);
      if (!dr.ok) errs.push("디지털화 시작 실패: " + dr.msg);
    }
  } catch (e: any) {
    errs.push(String(e?.message ?? e));
  }
  revalidatePath("/exams");
  revalidatePath(`/exams/${code}`);
  return { ok: true, aiErr: errs.length ? errs.join(" / ") : undefined };
}

/**
* 이미 정답·해설이 있는 시험(마이그레이션된 시험, 또는 손으로 직접 입력한 시험)에, 브라우저가
* Storage로 방금 직접 올린 "원본 PDF 파일"만 연결한다 — AI 자동 처리(문항 추출·풀이)는 절대
* 시작하지 않는다. QR·정오표가 포함된 시험지 PDF 다운로드 기능은 원본 PDF가 저장돼 있어야 동작하는데,
* 마이그레이션으로 옮긴 시험은 정답·해설 등 구조화된 데이터만 옮기고 원본 PDF 파일은
* 옮기지 않아서 다운로드가 안 되는 문제(2026-09 버그 리포트)가 있었다 — 이 액션이 그 해결책.
* editor 이상이면 쓸 수 있게 열어 둔다(AI 처리와 달리 비용이 들지 않는 단순 저장이라 — 실제로
* editor 계정이 이 통로로 Storage에 쓸 수 있으려면 RLS도 같이 넓혀야 했는데, 0015 마이그레이션에서
* 처리했다: 예전에는 이 주석과 달리 정책이 admin 전용으로 남아 있어 editor 계정은 항상 실패했었다).
*/
export async function finalizeAttachExamPdfOnly(code: string) {
  const { userId } = await requireRole("editor");
  const exam = await getExamByCode(code);
  if (!exam) return { ok: false, msg: "시험을 찾을 수 없습니다." };

  const supabase = await createClient();
  try {
    await finalizePdfUpload(supabase, exam.id, { isScanned: null, uploadedBy: userId });
  } catch (e: any) {
    return { ok: false, msg: "PDF 저장에 실패했습니다: " + String(e?.message ?? e) };
  }
  // 2026-09-29: PDF가 바뀌면 예전 PDF 기준 문항 잘라 보기 좌표는 틀리므로 지우고 새 PDF에서 다시 찾게 한다(lib/ai/relocate.ts)
  try {
    await applyNewPdfLocations(createAdminClient(), exam.id, []);
  } catch {
    /* 무시 — AI 설정의 영역 찾기로 다시 할 수 있음 */
  }
  revalidatePath(`/exams/${code}`);
  return { ok: true, msg: "원본 PDF를 저장했습니다. 이제 QR·정오표 PDF를 다운로드할 수 있습니다." };
}

/**
* 이미 있는 시험에, 브라우저가 Storage로 방금 직접 올린 PDF를 연결하고 AI 자동 처리를 (다시)
* 시작한다(스캔본으로 표시했으면 디지털화도 같이 시작).
*/
export async function finalizeUploadPdfAndStartAi(
  code: string,
  opts: { isScanned: boolean; startDigitize: boolean }
): Promise<{ ok: boolean; msg?: string }> {
  const { userId } = await requireRole("admin");
  const exam = await getExamByCode(code);
  if (!exam) return { ok: false, msg: "시험을 찾을 수 없습니다." };

  const supabase = await createClient();
  try {
    await finalizePdfUpload(supabase, exam.id, { isScanned: opts.isScanned, uploadedBy: userId });
  } catch (e: any) {
    return { ok: false, msg: "PDF 저장에 실패했습니다: " + String(e?.message ?? e) };
  }
  const r = await startExamAiJob(supabase, exam.id);
  const errs: string[] = [];
  if (!r.ok) errs.push(r.msg);
  if (opts.startDigitize) {
    const dr = await startDigitizeJob(supabase, exam.id);
    if (!dr.ok) errs.push("디지털화 시작 실패: " + dr.msg);
  }
  revalidatePath(`/exams/${code}`);
  return { ok: errs.length === 0, msg: errs.join(" / ") || undefined };
}

/** 이미 저장된 PDF로 AI 자동 처리를 (다시) 시작한다 — 오류로 멈췄을 때 재시도용. */
export async function startAiProcessing(code: string) {
  await requireRole("admin");
  const exam = await getExamByCode(code);
  if (!exam) return { ok: false, msg: "시험을 찾을 수 없습니다." };
  const supabase = await createClient();
  const r = await startExamAiJob(supabase, exam.id);
  revalidatePath(`/exams/${code}`);
  return r;
}
export async function cancelAiProcessing(code: string) {
  await requireRole("admin");
  const exam = await getExamByCode(code);
  if (!exam) return { ok: false, msg: "시험을 찾을 수 없습니다." };
  const supabase = await createClient();
  const r = await cancelExamAiJob(supabase, exam.id);
  revalidatePath(`/exams/${code}`);
  return r;
}

export type JobPoll = {
  stage: string;
  message: string;
  updatedAt: string;
  progress: { done: number; total: number } | null;
} | null;

/** 진행 화면이 몇 초마다 부르는 폴링 액션. 부를 때마다 파이프라인이 한 걸음 진행한다(lazy tick). */
export async function pollAiJob(code: string): Promise<JobPoll> {
  await requireRole("admin");
  const exam = await getExamByCode(code);
  if (!exam) return null;
  const supabase = await createClient();
  const job = await tickExamJob(supabase, exam.id);
  if (!job) return null;
  const qs = Array.isArray(job.state?.qs) ? job.state.qs.length : 0;
  const done = typeof job.state?.done === "number" ? job.state.done : 0;
  return {
    stage: job.stage,
    message: job.message,
    updatedAt: job.updatedAt,
    progress: qs > 0 ? { done, total: qs } : null,
  };
}

/** 검수 화면에서 정답·해설을 확인한 뒤 확정 — 시험을 '열림'으로 바꾸고 작업을 done으로 마무리한다. */
export async function approveAiReview(code: string) {
  await requireRole("admin");
  const exam = await getExamByCode(code);
  if (!exam) return { ok: false, msg: "시험을 찾을 수 없습니다." };
  if (exam.status !== "검수대기") return { ok: false, msg: "검수 대기 중인 시험이 아닙니다." };

  const supabase = await createClient();
  const { count } = await supabase
  .from("answer_key")
  .select("id", { count: "exact", head: true })
  .eq("exam_id", exam.id);
  if (!count) return { ok: false, msg: "정답이 없어 열 수 없습니다." };

  const { error } = await (supabase.from("exams") as any).update({ status: "열림" }).eq("id", exam.id);
  if (error) return { ok: false, msg: "확정하지 못했습니다: " + error.message };

  const job = await getJob(supabase, exam.id);
  if (job && !isActiveStage(job.stage)) {
    await setJob(supabase, exam.id, "done", "선생님이 확인하고 시험을 열었습니다.", job.state);
  }

  revalidatePath(`/exams/${code}`);
  revalidatePath("/exams");
  return { ok: true };
}

