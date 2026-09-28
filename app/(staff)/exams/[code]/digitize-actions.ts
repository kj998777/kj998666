"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { cancelDigitizeJob, startDigitizeJob, tickDigitizeJob } from "@/lib/ai/digitize";
import { finalizePdfUpload } from "@/lib/ai/pdf";
import { applyNewPdfLocations } from "@/lib/ai/relocate";
import { createAdminClient } from "@/lib/supabase/admin";

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

/**
* #2(2026-09-28): 디지털화가 끝난(dg_done) 뒤, 브라우저가 buildDigitizedPdf.ts로 이미 만들어서
* Storage(exam-pdfs/{examId}.pdf)에 원본 자리에 직접 덮어쓴 PDF를 "원본"으로 확정한다
* (DigitizeControl.tsx의 "디지털 시험지를 원본으로 적용" 버튼). PDF 조판 자체(buildDigitizedPdf.ts)는
* 브라우저 캔버스·pdf.js·html2canvas·KaTeX에 의존하는 순수 브라우저 코드라 이 서버 액션에서는 만들
* 수 없다 — 그래서 "이미 브라우저가 만들어 올린 파일"의 exam_pdf_meta만 정리한다(원장님 확인,
* 2026-09-28: 완전 자동화는 서버에 헤드리스 브라우저가 필요해 Vercel Hobby 플랜에서는 무리이므로
* 이 원클릭 적용까지가 이번 범위).
*/
export async function applyDigitizedPdfAsOriginal(code: string, locations?: unknown) {
    const { userId } = await requireRole("admin");
    const exam = await getExamByCode(code);
    if (!exam) return { ok: false, msg: "시험을 찾을 수 없습니다." };
    const supabase = await createClient();
    try {
        await finalizePdfUpload(supabase, exam.id, { isScanned: false, uploadedBy: userId, source: "digitized" });
    } catch (e: any) {
        return { ok: false, msg: "적용하지 못했습니다: " + String(e?.message ?? e) };
    }
    // 2026-09-29: PDF가 새로 조판됐으니 문항 잘라 보기 좌표도 새 PDF 기준으로 바꾼다(lib/ai/relocate.ts).
    // 영역 찾기 작업 표는 서비스롤로만 쓸 수 있어 admin 클라이언트로 부른다(권한은 위 requireRole로 확인함).
    try {
        await applyNewPdfLocations(createAdminClient(), exam.id, locations ?? []);
    } catch {
        /* 좌표 갱신 실패는 적용 자체를 막지 않음 — AI 설정의 영역 찾기로 다시 할 수 있음 */
    }
    revalidatePath(`/exams/${code}`);
    return { ok: true };
}
