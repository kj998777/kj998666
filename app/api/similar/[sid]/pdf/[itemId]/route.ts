import { createAdminClient } from "@/lib/supabase/admin";
import { getExamPdfBuffer } from "@/lib/ai/pdf";
import { pageResponse, pdfPageOf } from "@/lib/bank/singlePage";
import { allowedItem, loadSimilarPage } from "@/lib/similar/load";

// 오답 유사문제 화면(/r/[sid])의 문제 그림용 — 그 제출 화면에 나온 문항(유사문제·학생이 틀린 원래 문항)의 시험지
// 쪽 하나만 준다(시험지 전체·정답 쪽은 주지 않음). 문항이 다음 쪽으로 넘어가는 경우만 생각해 그 쪽 +1쪽까지 허용.
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: { sid: string; itemId: string } }) {
  const admin = createAdminClient();
  const page = await loadSimilarPage(admin, params.sid);
  if (!page || !allowedItem(page, params.itemId)) {
    return Response.json({ ok: false, msg: "볼 수 없는 문항입니다." }, { status: 404 });
  }
  const { data: ie } = await admin.from("item_explanations").select("exam_id, source_page").eq("id", params.itemId).maybeSingle();
  const want = Number(new URL(request.url).searchParams.get("page"));
  const base = Number(ie?.source_page);
  if (!ie || !Number.isFinite(base) || !Number.isFinite(want) || want < base || want > base + 1) {
    return Response.json({ ok: false, msg: "그 쪽은 볼 수 없습니다." }, { status: 404 });
  }
  let bytes: Buffer;
  try {
    bytes = await getExamPdfBuffer(admin, ie.exam_id);
  } catch {
    return Response.json({ ok: false, msg: "시험지를 불러오지 못했습니다." }, { status: 404 });
  }
  const one = await pdfPageOf(bytes, want).catch(() => null);
  if (!one) return Response.json({ ok: false, msg: "그 쪽이 없습니다." }, { status: 404 });
  return pageResponse(one);
}
