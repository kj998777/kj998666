import { requireTutorApi } from "@/lib/auth/requireTutor";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { attachDigitized, loadBankDetails } from "@/lib/bank/load";

// 내가 만든 맞춤 시험지의 문항 자세히(정답·풀이·자리) — 시험지·정답 해설지 PDF를 브라우저에서 만들 때(2026-09-30).
// 시험지는 본인 것만(RLS로 확인) 읽고, 문항은 서비스롤로 읽는다(과외선생님 세션은 문항 표를 못 읽음).
// 그림을 오릴 PDF는 그 문항이 있는 쪽 하나만 주므로(page/[itemId]) 쪽 번호는 1로 바꿔 보낸다.
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const auth = await requireTutorApi();
  if (auth.error) return auth.error;
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return Response.json({ ok: false, msg: "시험지를 찾을 수 없습니다." }, { status: 404 });
  const supabase = await createClient();
  const { data: ws } = (await (supabase.from("tutor_worksheets") as any)
    .select("id, tutor_id, item_ids")
    .eq("id", params.id)
    .maybeSingle()) as any;
  if (!ws || ws.tutor_id !== auth.session.userId) return Response.json({ ok: false, msg: "시험지를 찾을 수 없습니다." }, { status: 404 });
  const admin = createAdminClient();
  const items = await attachDigitized(admin, await loadBankDetails(admin, (ws.item_ids as string[]) ?? []));
  const out = items.map((it) => ({ ...it, sourcePage: it.sourcePage ? 1 : null }));
  return Response.json({ ok: true, items: out }, { headers: { "Cache-Control": "no-store" } });
}
