"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { cancelDigitizeJob, startDigitizeJob, tickDigitizeJob } from "@/lib/ai/digitize";

// 스캔 시험지 디지털화(Feature 1) 관련 서버 액션. AI 비용이 드는 관리자 전용 기능이므로 전부 admin만.

async function getExamByCode(code: string) {
    const supabase = await createClient();
    const { data } = (await supabase.from("exams").select("id").eq("code", code).single()) as any;
    return data;
}

export type DigitizePoll = {
    stage: string;
    message: string;
    updatedAt: string;
    progress: { done: number; total: number } | null;
} | null;

export async function startDigitizeAction(code: string) {
    await requireRole("admin");
    const exam = await getExamByCode(code);
    if (!exam) return { ok: false, msg: "시험을 찾을 수 없습니다." };
    const supabase = await createClient();
    const r = await startDigitizeJob(supabase, exam.id);
    revalidatePath(`/exams/${code}`);
    return r;
}

export async function pollDigitizeAction(code: string): Promise<DigitizePoll> {
    await requireRole("admin");
    const exam = await getExamByCode(code);
    if (!exam) return null;
    const supabase = await createClient();
    const job = await tickDigitizeJob(supabase, exam.id);
    if (!job) return null;
    if (job.stage === "dg_done" || job.stage === "dg_error") revalidatePath(`/exams/${code}`);
    const total = typeof job.state?.totalPages === "number" ? job.state.totalPages : 0;
    const done = typeof job.state?.done === "number" ? job.state.done : 0;
    return {
          stage: job.stage,
          message: job.message,
          updatedAt: job.updatedAt,
          progress: total > 0 ? { done, total } : null,
    };
}

export async function cancelDigitizeAction(code: string) {
    await requireRole("admin");
    const exam = await getExamByCode(code);
    if (!exam) return { ok: false, msg: "시험을 찾을 수 없습니다." };
    const supabase = await createClient();
    const r = await cancelDigitizeJob(supabase, exam.id);
    revalidatePath(`/exams/${code}`);
    return r;
}
