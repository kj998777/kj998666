import { requireTutorApi } from "@/lib/auth/requireTutor";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getExamPdfBuffer } from "@/lib/ai/pdf";
import { pageResponse } from "@/lib/bank/singlePage";
import { examPage } from "@/lib/bank/pageCache";

// 검토 중인 문항의 원본 시험지 PDF를 새 탭에서 바로 볼 수 있게 스트림한다(다운로드가 아니라 뷰어용
// 이라 Content-Disposition을 일부러 붙이지 않음 — original-pdf/route.ts와 같은 패턴).
//
// 버킷(exam-pdfs) 자체의 RLS(is_staff() 기반)는 tutor를 차단하므로, 여기서는 일반 세션 클라이언트로
// "지금 이 문항에 활성 클레임(또는 사후 검증 배정)을 갖고 있는가"만 RLS(item_explanations_select_
// tutor_claimed)로 확인한 뒤, 바이트 자체는 서비스롤 클라이언트로만 가져온다 — 버킷 정책에 tutor용
// 예외를 추가하지 않는다(설계 계획 5번 참고).
export async function GET(request: Request, { params }: { params: { itemId: string } }) {
  const auth = await requireTutorApi();
  if (auth.error) return auth.error;

  // 0037: 배정 여부는 DB 함수로 확인하고(과외선생님은 item_explanations를 직접 못 읽음), 시험 id는 서비스롤로 읽는다
  const supabase = await createClient();
  const { data: access } = (await (supabase.rpc as any)("tutor_item_access", { p_item_explanation_id: params.itemId })) as any;
  const { data: item } = access
    ? ((await createAdminClient().from("item_explanations").select("id, exam_id").eq("id", params.itemId).maybeSingle()) as any)
    : { data: null };

  if (!item) {
    return Response.json(
      { ok: false, msg: "이 문항에 접근할 수 없습니다(배정이 만료됐을 수 있습니다)." },
      { status: 403 }
    );
  }

  const admin = createAdminClient();
  // 2026-10-01: ?page=N 이면 그 쪽 하나만(휴대폰에서 문항마다 시험지 전체를 받지 않게 — ProblemPageImage pageUrl)
  // 2026-10-05: 그 쪽도 잘라 둔 것을 쓴다(lib/bank/pageCache.ts — Storage 전송량 줄이기)
  const pageParam = new URL(request.url).searchParams.get("page");
  if (pageParam) {
    let one: { bytes: Uint8Array; total: number } | null = null;
    try {
      one = await examPage(admin, item.exam_id, Number(pageParam));
    } catch (e: any) {
      return Response.json({ ok: false, msg: e?.message || "PDF를 불러오지 못했습니다." }, { status: 404 });
    }
    if (!one) return Response.json({ ok: false, msg: "그 쪽이 없습니다." }, { status: 404 });
    return pageResponse(one);
  }

  let bytes: Buffer;
  try {
    bytes = await getExamPdfBuffer(admin, item.exam_id);
  } catch (e: any) {
    return Response.json({ ok: false, msg: e?.message || "PDF를 불러오지 못했습니다." }, { status: 404 });
  }

  return new Response(bytes as any, {
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": "no-store",
    },
  });
}
