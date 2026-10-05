import { createAdminClient } from "@/lib/supabase/admin";
import { allowedItem, loadSimilarPage } from "@/lib/similar/load";
import { serveItemPage } from "@/lib/similar/servePage";

// 오답 유사문제 화면(/r/[sid])의 문제 그림용 — 그 제출 화면에 나온 문항(선생님이 고른 유사문제·학생이 틀린 원래 문항)의
// 시험지 쪽 하나만 준다(lib/similar/servePage.ts).
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: { sid: string; itemId: string } }) {
  const admin = createAdminClient();
  const page = await loadSimilarPage(admin, params.sid);
  if (!page || !allowedItem(page, params.itemId)) {
    return Response.json({ ok: false, msg: "볼 수 없는 문항입니다." }, { status: 404 });
  }
  return serveItemPage(admin, params.itemId, request);
}
