import { requireTutorApi } from "@/lib/auth/requireTutor";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPurchasedExam } from "@/lib/tutor/purchased";
import { buildReportData } from "@/lib/report/reportData";

export const dynamic = "force-dynamic";

// #4: 과외선생님 보고서 데이터 — 구매한 시험만, 그리고 본인 전용 링크로 들어온 제출만 담는다.
// 과외선생님 세션은 정답표·해설 RLS를 통과하지 못하므로 구매 확인 뒤 서비스롤로 읽되,
// 제출(submissions)은 tutor_id = 본인으로 반드시 거른다(buildReportData의 opts.tutorId).
export async function GET(_request: Request, { params }: { params: { code: string } }) {
  const auth = await requireTutorApi();
  if (auth.error) return auth.error;

  const exam = await getPurchasedExam(auth.session.userId, decodeURIComponent(params.code));
  if (!exam) return Response.json({ ok: false, msg: "구매한 시험이 아닙니다." }, { status: 403 });

  const body = await buildReportData(createAdminClient(), exam, { tutorId: auth.session.userId });
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
