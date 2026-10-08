import { createAdminClient } from "@/lib/supabase/admin";
import { allowedPickItem, loadPickPageShared } from "@/lib/similar/load";
import { canPickFor } from "@/lib/similar/pickAuth";
import { serveItemPage } from "@/lib/similar/servePage";

// 선생님이 오답 유사문제를 고르는 화면의 문제 그림용 — 고를 수 있는 사람(lib/similar/pickAuth.ts)에게, 그 제출의
// 후보 문항·원래 문항의 시험지 쪽 하나만 준다.
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: { sid: string; itemId: string } }) {
  const admin = createAdminClient();
  const auth = await canPickFor(admin, params.sid);
  if (!auth.ok) return Response.json({ ok: false, msg: auth.msg }, { status: auth.status });
  const page = await loadPickPageShared(admin, params.sid);
  if (!page || !allowedPickItem(page, params.itemId)) {
    return Response.json({ ok: false, msg: "볼 수 없는 문항입니다." }, { status: 404 });
  }
  return serveItemPage(admin, params.itemId, request);
}
