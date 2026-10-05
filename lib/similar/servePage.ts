import "server-only";
import { pageResponse } from "@/lib/bank/singlePage";
import { examPage } from "@/lib/bank/pageCache";

// 문항 하나가 있는 시험지 쪽만 PDF로 돌려준다(시험지 전체·정답 쪽은 주지 않음). 문항이 다음 쪽으로 넘어가는
// 경우만 생각해 그 쪽 +1쪽까지 허용. 학생 화면(/api/similar/[sid]/pdf)과 선생님 고르기 화면(/api/similar/[sid]/pick-pdf)이
// 각자 "볼 수 있는 문항인가"를 확인한 뒤 부른다.
export async function serveItemPage(admin: any, itemId: string, request: Request): Promise<Response> {
  const { data: ie } = await admin.from("item_explanations").select("exam_id, source_page").eq("id", itemId).maybeSingle();
  const want = Number(new URL(request.url).searchParams.get("page"));
  const base = Number(ie?.source_page);
  if (!ie || !Number.isFinite(base) || !Number.isFinite(want) || want < base || want > base + 1) {
    return Response.json({ ok: false, msg: "그 쪽은 볼 수 없습니다." }, { status: 404 });
  }
  let one: { bytes: Uint8Array; total: number } | null = null;
  try {
    one = await examPage(admin, ie.exam_id, want); // 잘라 둔 쪽(lib/bank/pageCache.ts)
  } catch {
    return Response.json({ ok: false, msg: "시험지를 불러오지 못했습니다." }, { status: 404 });
  }
  if (!one) return Response.json({ ok: false, msg: "그 쪽이 없습니다." }, { status: 404 });
  return pageResponse(one);
}
