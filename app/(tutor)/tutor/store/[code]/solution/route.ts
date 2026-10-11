import { requireTutorApi } from "@/lib/auth/requireTutor";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPurchasedExam } from "@/lib/tutor/purchased";
import { solutionPdfResponse } from "@/lib/exams/solutionPdf";

// 고3 사설 모의고사 해설지 PDF — 그 시험을 산 과외선생님에게만(구매 확인 뒤 서비스롤로 읽음, 버킷 RLS는 그대로).
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { code: string } }) {
  const auth = await requireTutorApi();
  if (auth.error) return auth.error;
  const exam = await getPurchasedExam(auth.session.userId, decodeURIComponent(params.code));
  if (!exam) return Response.json({ ok: false, msg: "이 시험을 아직 구매하지 않았습니다." }, { status: 403 });
  const admin = createAdminClient();
  const { data: row } = (await (admin.from("exams") as any).select("code, name, solution_pdf_path").eq("id", exam.id).maybeSingle()) as any;
  if (!row) return Response.json({ ok: false, msg: "시험을 찾을 수 없습니다." }, { status: 404 });
  return solutionPdfResponse(admin, row);
}
