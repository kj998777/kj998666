import { getSessionAndRole } from "@/lib/auth/requireRole";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadVisibleTest } from "@/lib/placement/server";
import { singlePagePdf } from "@/lib/bank/singlePage";

// 입학테스트 문항이 인쇄된 쪽 하나만 PDF로(0047). 볼 수 있는 테스트(RLS)에 들어 있는 문항만 준다.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(_request: Request, { params }: { params: { id: string; itemId: string } }) {
  const bad = () => Response.json({ ok: false, msg: "쪽을 찾을 수 없습니다." }, { status: 404 });
  const s = await getSessionAndRole();
  if (!s) return Response.json({ ok: false, msg: "로그인이 필요합니다." }, { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(params.itemId)) return bad();
  const test = await loadVisibleTest(params.id);
  if (!test || !(test.item_ids ?? []).includes(params.itemId)) return bad();
  const bytes = await singlePagePdf(createAdminClient(), params.itemId);
  if (!bytes) return bad();
  return new Response(bytes as any, { headers: { "Content-Type": "application/pdf", "Cache-Control": "private, no-store" } });
}
