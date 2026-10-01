import { getSessionAndRole } from "@/lib/auth/requireRole";
import { loadTestDetails, loadVisibleTest } from "@/lib/placement/server";

// 입학테스트 문항 자세히(정답·풀이·자리) — 시험지·정답 해설지·진단 보고서 PDF를 브라우저에서 만들 때(0047).
// 볼 수 있는 테스트인지는 RLS(만든 사람·관리자, 학원 테스트는 직원 모두)로 확인한다.
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const s = await getSessionAndRole();
  if (!s) return Response.json({ ok: false, msg: "로그인이 필요합니다." }, { status: 401 });
  const test = await loadVisibleTest(params.id);
  if (!test) return Response.json({ ok: false, msg: "입학테스트를 찾을 수 없습니다." }, { status: 404 });
  const items = await loadTestDetails(test);
  return Response.json({ ok: true, items }, { headers: { "Cache-Control": "no-store" } });
}
