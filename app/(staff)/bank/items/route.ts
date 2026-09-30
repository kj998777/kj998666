import { requireApiRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { attachDigitized, loadBankDetails } from "@/lib/bank/load";
import { createAdminClient } from "@/lib/supabase/admin";

// 문항 은행에 담은 문항들의 자세한 내용(풀이·문항 자리) — 시험지·정답 해설지를 만들 때 브라우저가 부른다. 편집자 이상.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireApiRole("editor");
  if (auth.error) return auth.error;
  let ids: string[] = [];
  try {
    const body = await request.json();
    ids = Array.isArray(body?.ids) ? body.ids.map(String) : [];
  } catch {
    /* 빈 요청 */
  }
  const supabase = await createClient();
  // 권한은 위에서 확인(편집자 이상) — 디지털화 글은 관리자 전용 표라 서비스롤로 붙인다
  const items = await attachDigitized(createAdminClient(), await loadBankDetails(supabase, ids));
  return Response.json({ ok: true, items }, { headers: { "Cache-Control": "no-store" } });
}
