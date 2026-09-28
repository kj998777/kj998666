import { requireApiRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { buildReportData } from "@/lib/report/reportData";

// 보고서 만들기(종합/개별 PDF) 기능이 브라우저에서 필요로 하는 데이터를 한 번에 내려준다.
// 옛 Apps Script 시스템(teacher-report-app.md, dg2025-report-content.md)의 보고서는 시트 값을
// 손으로 옮겨 파이썬 스크립트에 채워 넣었지만, 여기서는 answer_key/item_explanations/
// submissions+grading_results/exam_notes/exam_corrections 를 그대로 읽어 그 자리에서 재구성한다.
// 조회만 하므로 viewer 이상이면 된다(비용이 드는 AI 작업이 아님).
export async function GET(_request: Request, { params }: { params: { code: string } }) {
  const auth = await requireApiRole("viewer");
  if (auth.error) return auth.error;

  const code = decodeURIComponent(params.code);
  const supabase = await createClient();
  const { data: exam } = (await supabase.from("exams").select("id, code, name").eq("code", code).single()) as any;
  if (!exam) return Response.json({ ok: false, msg: "시험을 찾을 수 없습니다." }, { status: 404 });

  const body = await buildReportData(supabase, exam);
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
