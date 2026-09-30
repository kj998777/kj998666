"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { cancelDigitizeJob, startDigitizeJob, tickDigitizeJob } from "@/lib/ai/digitize";
import { backupScanBeforeDigitizedApply, finalizePdfUpload, restoreScanPdf } from "@/lib/ai/pdf";
import { applyNewPdfLocations } from "@/lib/ai/relocate";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanItemText, mergeItemText } from "@/lib/digitize/itemEdit";
import { textHash } from "@/lib/digitize/suspect";

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
    // 2026-09-29: 스캔본을 지우기 전에 따로 보관(그림 자리 고치기·다시 조판에 필요). 권한 문제 없게 서비스롤로.
    try {
        await backupScanBeforeDigitizedApply(createAdminClient(), exam.id);
    } catch (e: any) {
        return { ok: false, msg: String(e?.message ?? e) + " — 적용을 멈췄습니다(스캔본은 그대로 있어요)." };
    }
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

/**
 * 2026-09-29 원장님 요청: 디지털 시험지의 그림 자리를 관리자가 원본 쪽 위에서 직접 네모로 지정해 고친다(FigureFixPanel.tsx).
 * 쪽(page_no)의 items[itemIndex].figures 를 통째로 바꾼다(고치기·추가·빼기 모두). 사람이 지정한 그림은 manual: true 로
 * 표시해 조판할 때 자동 보정(lib/digitize/figureRefine.ts)을 건너뛴다. 처음 고칠 때 AI가 준 자리는 ai 에 남겨 되돌릴 수 있게 한다.
 */
export async function saveDigitizedFigures(
    code: string,
    pageNo: number,
    itemIndex: number,
    figures: { x0: number; y0: number; x1: number; y1: number; where?: string; manual?: boolean; ai?: any }[]
) {
    await requireRole("admin");
    const exam = await getExamByCode(code);
    if (!exam) return { ok: false, msg: "시험을 찾을 수 없습니다." };
    if (!Number.isInteger(pageNo) || pageNo < 1 || !Number.isInteger(itemIndex) || itemIndex < 0) return { ok: false, msg: "문항 정보가 올바르지 않습니다." };
    if (!Array.isArray(figures) || figures.length > 8) return { ok: false, msg: "그림은 문항당 8개까지입니다." };
    const num = (v: any) => Math.max(0, Math.min(1000, Math.round(Number(v))));
    const box = (b: any) => {
        if (!b || typeof b !== "object") return null;
        const x0 = num(b.x0), y0 = num(b.y0), x1 = num(b.x1), y1 = num(b.y1);
        if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
        return { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
    };
    const clean: any[] = [];
    for (const f of figures) {
        const b = box(f);
        if (!b || b.x1 - b.x0 < 5 || b.y1 - b.y0 < 5) return { ok: false, msg: "그림 영역이 너무 작습니다. 다시 그려 주세요." };
        const out: any = { ...b, where: f.where === "end" ? "end" : "stem" };
        if (f.manual) out.manual = true;
        const ai = box(f.ai);
        if (ai) out.ai = ai;
        clean.push(out);
    }
    const supabase = await createClient();
    const { data: row, error } = (await supabase
        .from("digitized_pages")
        .select("id, data")
        .eq("exam_id", exam.id)
        .eq("page_no", pageNo)
        .maybeSingle()) as any;
    if (error || !row) return { ok: false, msg: "디지털화된 쪽을 찾지 못했습니다." };
    const data = row.data && typeof row.data === "object" ? row.data : {};
    const items = Array.isArray(data.items) ? data.items : [];
    if (!items[itemIndex] || items[itemIndex].type !== "question") return { ok: false, msg: "문항을 찾지 못했습니다. 새로고침해 주세요." };
    items[itemIndex] = { ...items[itemIndex], figures: clean };
    const { error: upErr } = await (supabase.from("digitized_pages") as any).update({ data: { ...data, items } }).eq("id", row.id);
    if (upErr) return { ok: false, msg: "저장하지 못했습니다: " + upErr.message };
    return { ok: true };
}

/**
 * 2026-09-29: '원본으로 적용'하면서 스캔본이 지워진 예전 시험에 스캔 PDF만 다시 넣는다. 디지털화 결과(문항·그림 자리)는 그대로 두고,
 * 그림 다시 오리기·그림 자리 직접 고치기가 다시 되게 한다. 브라우저가 uploadScanRestoreDirect로 올린 경로를 받는다.
 */
export async function restoreScanPdfAction(code: string, uploadedPath: string) {
    await requireRole("admin");
    const exam = await getExamByCode(code);
    if (!exam) return { ok: false, msg: "시험을 찾을 수 없습니다." };
    const path = String(uploadedPath || "");
    if (!new RegExp(`^${exam.id}/scan-upload-\\d+\\.pdf$`).test(path)) return { ok: false, msg: "올린 파일 경로가 올바르지 않습니다." };
    try {
        const r = await restoreScanPdf(createAdminClient(), exam.id, path);
        revalidatePath(`/exams/${code}`);
        return { ok: true, pages: r.pages };
    } catch (e: any) {
        return { ok: false, msg: String(e?.message ?? e) };
    }
}

/**
 * 2026-09-30 원장님 요청: 디지털화 때 숫자·글자를 잘못 옮겨 적은 문항 하나를 고친다(ItemTextFixPanel.tsx).
 * source: "manual" = 직접 고침, "ai" = 그 문항만 AI로 다시 읽은 결과로 덮어씀, "revert" = AI가 처음 읽은 글로 되돌림.
 * 글 부분만 바꾸고 그림 자리(figures)는 그대로 둔다. 처음 고칠 때 AI 원래 글을 orig에 남긴다(lib/digitize/itemEdit.ts).
 * 반영하려면 "디지털 시험지를 원본으로 적용"을 다시 누른다(그림 자리 고치기와 같음).
 */
export async function saveDigitizedItem(code: string, pageNo: number, itemIndex: number, fields: unknown, source: "manual" | "ai" | "revert") {
    await requireRole("admin");
    const exam = await getExamByCode(code);
    if (!exam) return { ok: false, msg: "시험을 찾을 수 없습니다." };
    if (!Number.isInteger(pageNo) || pageNo < 1 || !Number.isInteger(itemIndex) || itemIndex < 0) return { ok: false, msg: "문항 정보가 올바르지 않습니다." };
    if (!["manual", "ai", "revert"].includes(source)) return { ok: false, msg: "알 수 없는 저장 방식입니다." };
    const supabase = await createClient();
    const { data: row, error } = (await supabase
        .from("digitized_pages")
        .select("id, data")
        .eq("exam_id", exam.id)
        .eq("page_no", pageNo)
        .maybeSingle()) as any;
    if (error || !row) return { ok: false, msg: "디지털화된 쪽을 찾지 못했습니다." };
    const data = row.data && typeof row.data === "object" ? row.data : {};
    const items = Array.isArray(data.items) ? [...data.items] : [];
    const cur = items[itemIndex];
    if (!cur || cur.type !== "question") return { ok: false, msg: "문항을 찾지 못했습니다. 새로고침해 주세요." };
    let input: unknown = fields;
    if (source === "revert") {
        if (!cur.orig) return { ok: false, msg: "되돌릴 AI 원래 글이 없습니다." };
        input = cur.orig;
    }
    const c = cleanItemText(input);
    if (!c.ok) return { ok: false, msg: c.msg };
    items[itemIndex] = mergeItemText(cur, c.text, source, new Date().toISOString());
    const { error: upErr } = await (supabase.from("digitized_pages") as any).update({ data: { ...data, items } }).eq("id", row.id);
    if (upErr) return { ok: false, msg: "저장하지 못했습니다: " + upErr.message };
    return { ok: true, item: items[itemIndex] };
}

/**
 * 2026-09-30: 디지털화 의심 문항(lib/digitize/suspect.ts)에서 원장님이 확인하고 "문제없음"을 누른 문항.
 * 그때의 글 지문(ok_hash)을 남겨, 글이 바뀌기 전까지는 의심 목록에 다시 띄우지 않는다. ok=false면 표시를 지운다.
 */
export async function markDigitizedOk(code: string, pageNo: number, itemIndex: number, ok = true) {
    await requireRole("admin");
    const exam = await getExamByCode(code);
    if (!exam) return { ok: false, msg: "시험을 찾을 수 없습니다." };
    if (!Number.isInteger(pageNo) || pageNo < 1 || !Number.isInteger(itemIndex) || itemIndex < 0) return { ok: false, msg: "문항 정보가 올바르지 않습니다." };
    const supabase = await createClient();
    const { data: row, error } = (await supabase
        .from("digitized_pages")
        .select("id, data")
        .eq("exam_id", exam.id)
        .eq("page_no", pageNo)
        .maybeSingle()) as any;
    if (error || !row) return { ok: false, msg: "디지털화된 쪽을 찾지 못했습니다." };
    const data = row.data && typeof row.data === "object" ? row.data : {};
    const items = Array.isArray(data.items) ? [...data.items] : [];
    const cur = items[itemIndex];
    if (!cur || cur.type !== "question") return { ok: false, msg: "문항을 찾지 못했습니다. 새로고침해 주세요." };
    const next: any = { ...cur };
    if (ok) {
        next.ok_hash = textHash(cur);
        next.ok_at = new Date().toISOString();
    } else {
        delete next.ok_hash;
        delete next.ok_at;
    }
    items[itemIndex] = next;
    const { error: upErr } = await (supabase.from("digitized_pages") as any).update({ data: { ...data, items } }).eq("id", row.id);
    if (upErr) return { ok: false, msg: "저장하지 못했습니다: " + upErr.message };
    revalidatePath("/admin/digitize-check");
    return { ok: true };
}
