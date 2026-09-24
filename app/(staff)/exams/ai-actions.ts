"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { saveExamPdf } from "@/lib/ai/pdf";
import { countPdfPages } from "@/lib/ai/pdfMeta";
import { startExamAiJob, cancelExamAiJob, tickExamJob } from "@/lib/ai/pipeline";
import { getJob, isActiveStage, setJob } from "@/lib/ai/job";
import type { SchoolLevel } from "@/lib/supabase/types";

// AI 자동 처리(시험지 업로드 → 문항 추출 → 풀이 → 검수) 관련 서버 액션들.
// 비용이 드는 작업이라 전부 admin 전용으로 막는다(화면에서도 admin에게만 버튼을 보여줌 — 이중 방어).

async function getExamByCode(code: string) {
  const supabase = await createClient();
  const { data } = (await supabase.from("exams").select("*").eq("code", code).single()) as any;
  return data;
}

async function readPdf(formData: FormData): Promise<Buffer | { err: string }> {
  const file = formData.get("pdf");
  if (!(file instanceof File) || file.size === 0) return { err: "시험지 PDF 파일을 선택해 주세요." };
  if (file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return { err: "PDF 파일만 올릴 수 있습니다." };
  }
  // Vercel 서버리스 함수는 무료 플랜 기준 요청 본문이 약 4.5MB로 제한돼 있어(Next.js 설정으로는
  // 못 늘림), 시험지 PDF도 그 안쪽으로 넉넉히 잡아 둔다. 스캔본이라 용량이 크면 화질을 낮춰 다시
  // 만들어 올려야 한다 — 기존 Apps Script는 이 제한이 없었던 부분이라 사용자에게 안내가 필요함.
  if (file.size > 4 * 1024 * 1024) return { err: "PDF 용량이 너무 큽니다(4MB 이하로 줄여서 올려 주세요 — 서버 업로드 용량 제한)." };
  const buf = Buffer.from(await file.arrayBuffer());
  return buf;
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

/** 새 시험을 만들면서 곧바로 시험지 PDF를 올리고 AI 자동 처리를 시작한다. */
export async function createAiExam(formData: FormData) {
  const { userId } = await requireRole("admin");

  const code = String(formData.get("code") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!code) return { ok: false, msg: "시험 코드를 입력해 주세요." };
  if (!name) return { ok: false, msg: "시험 이름을 입력해 주세요." };

  const pdf = await readPdf(formData);
  if (!Buffer.isBuffer(pdf)) return { ok: false, msg: pdf.err };

  const supabase = await createClient();
  const { data: exam, error } = (await supabase
    .from("exams")
    .insert({ code, name, status: "닫힘", created_by: userId, school_level: schoolLevelField(formData), ...folderFields(formData) } as any)
    .select("id, code")
    .single()) as any;
  if (error) {
    const msg = error.code === "23505" ? "이미 사용 중인 시험 코드입니다." : "만들지 못했습니다: " + error.message;
    return { ok: false, msg };
  }

  // 주의: redirect()는 내부적으로 특수한 예외(NEXT_REDIRECT)를 던져서 동작하므로, 절대 try/catch
  // 안에서 부르면 안 된다(catch가 그 예외까지 잡아 버려 "오류"로 처리해 버림). 그래서 결과만 변수에
  // 담아 두고, redirect()는 try/catch를 완전히 빠져나온 뒤 한 곳에서만 부른다.
  let aiErr = "";
  try {
    const pages = await countPdfPages(pdf);
    await saveExamPdf(supabase, exam.id, pdf, { pages, isScanned: null, uploadedBy: userId });
    const r = await startExamAiJob(supabase, exam.id);
    if (!r.ok) aiErr = r.msg;
  } catch (e: any) {
    // 시험은 이미 만들어졌으니, PDF 업로드/시작 실패는 시험 상세 화면에서 다시 시도할 수 있게 안내만 한다.
    aiErr = String(e?.message ?? e);
  }

  revalidatePath("/exams");
  const url = `/exams/${encodeURIComponent(exam.code)}` + (aiErr ? `?aiErr=${encodeURIComponent(aiErr.slice(0, 200))}` : "");
  redirect(url);
}

/**
 * 이미 정답·해설이 있는 시험(마이그레이션된 시험, 또는 손으로 직접 입력한 시험)에
 * "원본 PDF 파일"만 연결한다 — AI 자동 처리(문항 추출·풀이)는 절대 시작하지 않는다.
 * QR·정오표가 포함된 시험지 PDF 다운로드 기능은 원본 PDF가 저장돼 있어야 동작하는데,
 * 마이그레이션으로 옮긴 시험은 정답·해설 등 구조화된 데이터만 옮기고 원본 PDF 파일은
 * 옮기지 않아서 다운로드가 안 되는 문제(2026-09 버그 리포트)가 있었다 — 이 액션이 그 해결책.
 * editor 이상이면 쓸 수 있게 열어 둔다(AI 처리와 달리 비용이 들지 않는 단순 저장이라).
 */
export async function attachExamPdfOnly(code: string, formData: FormData) {
  const { userId } = await requireRole("editor");
  const exam = await getExamByCode(code);
  if (!exam) return { ok: false, msg: "시험을 찾을 수 없습니다." };

  const pdf = await readPdf(formData);
  if (!Buffer.isBuffer(pdf)) return { ok: false, msg: pdf.err };

  const supabase = await createClient();
  try {
    const pages = await countPdfPages(pdf);
    await saveExamPdf(supabase, exam.id, pdf, { pages, isScanned: null, uploadedBy: userId });
  } catch (e: any) {
    return { ok: false, msg: "PDF 저장에 실패했습니다: " + String(e?.message ?? e) };
  }
  revalidatePath(`/exams/${code}`);
  return { ok: true, msg: "원본 PDF를 저장했습니다. 이제 QR·정오표 PDF를 다운로드할 수 있습니다." };
}

/** 이미 있는 시험에 시험지 PDF를 (다시) 올리고 AI 자동 처리를 시작한다. */
export async function uploadPdfAndStartAi(code: string, formData: FormData) {
  const { userId } = await requireRole("admin");
  const exam = await getExamByCode(code);
  if (!exam) return { ok: false, msg: "시험을 찾을 수 없습니다." };

  const pdf = await readPdf(formData);
  if (!Buffer.isBuffer(pdf)) return { ok: false, msg: pdf.err };

  const supabase = await createClient();
  try {
    const pages = await countPdfPages(pdf);
    await saveExamPdf(supabase, exam.id, pdf, { pages, isScanned: null, uploadedBy: userId });
  } catch (e: any) {
    return { ok: false, msg: "PDF 저장에 실패했습니다: " + String(e?.message ?? e) };
  }
  const r = await startExamAiJob(supabase, exam.id);
  revalidatePath(`/exams/${code}`);
  return r;
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
