import { requireApiRole } from "@/lib/auth/requireRole";
import { createAdminClient } from "@/lib/supabase/admin";
import { solutionPdfResponse } from "@/lib/exams/solutionPdf";

// 고3 사설 모의고사 해설지 PDF(원장님이 올린 것) — 직원(보기 권한 이상)에게.
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { code: string } }) {
  const auth = await requireApiRole("viewer");
  if (auth.error) return auth.error;
  const admin = createAdminClient();
  const { data: exam } = (await (admin.from("exams") as any)
    .select("code, name, solution_pdf_path")
    .eq("code", decodeURIComponent(params.code))
    .maybeSingle()) as any;
  if (!exam) return Response.json({ ok: false, msg: "시험을 찾을 수 없습니다." }, { status: 404 });
  return solutionPdfResponse(admin, exam);
}
