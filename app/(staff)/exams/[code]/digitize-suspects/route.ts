import { requireApiRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { loadDigitizeSuspects } from "@/lib/digitize/suspectLoad";

// 한 시험의 디지털화 의심 문항(문제 글 고치기 화면에 "!" 표시용, 2026-09-30). 관리자 전용.
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { code: string } }) {
  const auth = await requireApiRole("admin");
  if (auth.error) return auth.error;
  const code = decodeURIComponent(params.code);
  const supabase = await createClient();
  const { data: exam } = (await supabase.from("exams").select("id").eq("code", code).maybeSingle()) as any;
  if (!exam) return Response.json({ ok: false, msg: "시험을 찾을 수 없습니다." }, { status: 404 });
  const { rows } = await loadDigitizeSuspects(supabase, { examIds: [exam.id] });
  const suspects: Record<string, { score: number; reasons: string[] }> = {};
  for (const r of rows) suspects[`${r.pageNo}:${r.itemIndex}`] = { score: r.score, reasons: r.reasons.map((x) => x.text) };
  return Response.json({ ok: true, suspects }, { headers: { "Cache-Control": "no-store" } });
}
