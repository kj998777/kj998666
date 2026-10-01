import { requireTutorApi } from "@/lib/auth/requireTutor";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { singlePagePdf } from "@/lib/bank/singlePage";

// 맞춤 시험지에 담은 문항이 인쇄된 쪽 하나만 PDF로 준다(2026-09-30). 시험지 전체(정답·해설 쪽 포함)를 넘기지 않으려고
// 서버에서 그 쪽만 떼어 새 PDF로 만든다. 브라우저는 이 쪽에서 문항 자리를 찾아 오린다(buildWorksheet.ts).
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(_request: Request, { params }: { params: { id: string; itemId: string } }) {
  const auth = await requireTutorApi();
  if (auth.error) return auth.error;
  const bad = () => Response.json({ ok: false, msg: "쪽을 찾을 수 없습니다." }, { status: 404 });
  if (!/^[0-9a-f-]{36}$/i.test(params.id) || !/^[0-9a-f-]{36}$/i.test(params.itemId)) return bad();
  const supabase = await createClient();
  const { data: ws } = (await (supabase.from("tutor_worksheets") as any)
    .select("tutor_id, item_ids")
    .eq("id", params.id)
    .maybeSingle()) as any;
  if (!ws || ws.tutor_id !== auth.session.userId || !((ws.item_ids as string[]) ?? []).includes(params.itemId)) return bad();
  const bytes = await singlePagePdf(createAdminClient(), params.itemId);
  if (!bytes) return bad();
  return new Response(bytes as any, { headers: { "Content-Type": "application/pdf", "Cache-Control": "private, no-store" } });
}
