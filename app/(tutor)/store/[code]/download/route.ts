import { requireTutorApi } from "@/lib/auth/requireTutor";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getExamPdfBuffer } from "@/lib/ai/pdf";
import { contentDispositionAttachment } from "@/lib/http/contentDisposition";

// 실제 "다운로드"(기출 스토어) — purchase_exam_download RPC로 이미 구매(포인트 차감)한 시험만
// 통과시킨다. 이 GET 라우트 자체는 조회만 하고 아무것도 차감하지 않으므로 몇 번을 다시 받아도 안전.
export async function GET(_request: Request, { params }: { params: { code: string } }) {
  const auth = await requireTutorApi();
  if (auth.error) return auth.error;

  const code = decodeURIComponent(params.code);
  const supabase = await createClient();
  const { data: exam } = (await supabase
    .from("exams")
    .select("id, code, name")
    .eq("code", code)
    .maybeSingle()) as any;
  if (!exam) {
    return Response.json({ ok: false, msg: "시험을 찾을 수 없습니다." }, { status: 404 });
  }

  const { data: purchase } = (await supabase
    .from("tutor_exam_purchases")
    .select("id")
    .eq("exam_id", exam.id)
    .eq("tutor_id", auth.session.userId)
    .maybeSingle()) as any;
  if (!purchase) {
    return Response.json({ ok: false, msg: "이 시험을 아직 구매하지 않았습니다." }, { status: 403 });
  }

  const admin = createAdminClient();
  let bytes: Buffer;
  try {
    bytes = await getExamPdfBuffer(admin, exam.id);
  } catch (e: any) {
    return Response.json({ ok: false, msg: e?.message || "PDF를 불러오지 못했습니다." }, { status: 404 });
  }

  return new Response(bytes as any, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDispositionAttachment(`${exam.name}_${exam.code}.pdf`, `exam_${exam.id}.pdf`),
      "Cache-Control": "no-store",
    },
  });
}
