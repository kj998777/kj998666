import { requireApiRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";

// 디지털화된 쪽 데이터를 JSON으로 내려받는다(관리자 전용). 각 쪽을 새 PDF로 다시 조판하는 기능은
// 아직 없어서(lib/ai/digitize.ts 상단 주석 참고) 결과를 검토·재사용할 수 있게 원자료를 제공한다.
export async function GET(_request: Request, { params }: { params: { code: string } }) {
  const auth = await requireApiRole("admin");
  if (auth.error) return auth.error;

  const code = decodeURIComponent(params.code);
  const supabase = await createClient();
  const { data: exam } = (await supabase.from("exams").select("id, code, name").eq("code", code).single()) as any;
  if (!exam) return Response.json({ ok: false, msg: "시험을 찾을 수 없습니다." }, { status: 404 });

  const { data: pages, error } = (await supabase
    .from("digitized_pages")
    .select("page_no, data")
    .eq("exam_id", exam.id)
    .order("page_no")) as any;
  if (error) return Response.json({ ok: false, msg: error.message }, { status: 500 });

  const body = JSON.stringify({ exam: { code: exam.code, name: exam.name }, pages: pages ?? [] }, null, 2);
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="digitized_${exam.code}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
