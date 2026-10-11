import { requireApiRole } from "@/lib/auth/requireRole";
import { createAdminClient } from "@/lib/supabase/admin";
import { locateSolutionPagesFromPdf } from "@/lib/ai/mockAnswers";
import { SOLUTION_PAGE_BATCH } from "@/lib/exams/mockCsat";

// 고3 사설 모의고사 해설지에서 문항별 풀이 쪽 찾기의 한 묶음(from~to쪽) — 화면(MockCsatPanel)이 묶음마다 부르고 결과를 모아
// lib/exams/mockCsat.ts buildPageMap → saveSolutionPageMap으로 저장한다. 서버 액션이 아니라 API 라우트인 이유: 실행 시간
// (maxDuration)을 지정하고 여러 묶음을 동시에 부르려고(admin/logic-types/classify와 같은 이유).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: { code: string } }) {
  const auth = await requireApiRole("admin");
  if (auth.error) return auth.error;
  let body: { from?: unknown; to?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, msg: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const from = Math.max(1, Math.floor(Number(body.from) || 1));
  const to = Math.min(from + SOLUTION_PAGE_BATCH - 1, Math.max(from, Math.floor(Number(body.to) || from)));
  const admin = createAdminClient();
  const { data: exam } = (await (admin.from("exams") as any)
    .select("id, solution_pdf_path")
    .eq("code", decodeURIComponent(params.code))
    .maybeSingle()) as any;
  if (!exam) return Response.json({ ok: false, msg: "시험을 찾을 수 없습니다." }, { status: 404 });
  if (!exam.solution_pdf_path) return Response.json({ ok: false, msg: "먼저 해설지 PDF를 올려 주세요." }, { status: 400 });
  const { data, error } = await admin.storage.from("exam-pdfs").download(exam.solution_pdf_path);
  if (error || !data) return Response.json({ ok: false, msg: "해설지를 불러오지 못했습니다." }, { status: 500 });
  const r = await locateSolutionPagesFromPdf(admin, Buffer.from(await data.arrayBuffer()), from, to);
  return Response.json(r, { status: r.ok ? 200 : 502 });
}
