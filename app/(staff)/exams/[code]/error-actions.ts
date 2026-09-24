"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import {
  cancelErrorCheck,
  discardErrorCheck,
  getItemCheck,
  setErrorFlag,
  startErrorCheck,
  tickErrorCheck,
} from "@/lib/ai/errorcheck";

// 출제오류 의심(v37) 관련 서버 액션. AI 판단은 비용이 드는 관리자 전용 기능이므로 전부 admin만.

async function getExamByCode(code: string) {
  const supabase = await createClient();
  const { data } = (await supabase.from("exams").select("id").eq("code", code).single()) as any;
  return data;
}

export type ErrorCheckPoll = { stage: string; message: string; updatedAt: string } | null;

export async function startErrorCheckAction(code: string, label: string, hint: string) {
  await requireRole("admin");
  const exam = await getExamByCode(code);
  if (!exam) return { ok: false, msg: "시험을 찾을 수 없습니다." };
  const supabase = await createClient();
  const r = await startErrorCheck(supabase, exam.id, label, hint);
  revalidatePath(`/exams/${code}`);
  return r;
}

export async function pollErrorCheckAction(code: string, label: string): Promise<ErrorCheckPoll> {
  await requireRole("admin");
  const exam = await getExamByCode(code);
  if (!exam) return null;
  const supabase = await createClient();
  const check = await tickErrorCheck(supabase, exam.id, label);
  if (!check) return null;
  if (check.stage === "rx_done") revalidatePath(`/exams/${code}`);
  return { stage: check.stage, message: check.message, updatedAt: check.updatedAt };
}

export async function cancelErrorCheckAction(code: string, label: string) {
  await requireRole("admin");
  const exam = await getExamByCode(code);
  if (!exam) return { ok: false, msg: "시험을 찾을 수 없습니다." };
  const supabase = await createClient();
  const r = await cancelErrorCheck(supabase, exam.id, label);
  revalidatePath(`/exams/${code}`);
  return r;
}

export async function discardErrorCheckAction(code: string, label: string) {
  await requireRole("admin");
  const exam = await getExamByCode(code);
  if (!exam) return { ok: false, msg: "시험을 찾을 수 없습니다." };
  const supabase = await createClient();
  await discardErrorCheck(supabase, exam.id, label);
  revalidatePath(`/exams/${code}`);
  return { ok: true };
}

/** "AI 없이 바로 표시" / "표시 해제" */
export async function setErrorFlagAction(code: string, label: string, on: boolean, why: string) {
  await requireRole("admin");
  const exam = await getExamByCode(code);
  if (!exam) return { ok: false, msg: "시험을 찾을 수 없습니다." };
  const supabase = await createClient();
  const r = await setErrorFlag(supabase, exam.id, label, on, why);
  revalidatePath(`/exams/${code}`);
  return r;
}

export async function getErrorCheckAction(code: string, label: string): Promise<ErrorCheckPoll> {
  await requireRole("admin");
  const exam = await getExamByCode(code);
  if (!exam) return null;
  const supabase = await createClient();
  const check = await getItemCheck(supabase, exam.id, label);
  if (!check) return null;
  return { stage: check.stage, message: check.message, updatedAt: check.updatedAt };
}

