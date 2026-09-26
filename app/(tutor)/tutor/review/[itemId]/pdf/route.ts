import { requireTutorApi } from "@/lib/auth/requireTutor";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getExamPdfBuffer } from "@/lib/ai/pdf";

// 검토 중인 문항의 원본 시험지 PDF를 새 탭에서 바로 볼 수 있게 스트림한다(다운로드가 아니라 뷰어용
// 이라 Content-Disposition을 일부러 붙이지 않음 — original-pdf/route.ts와 같은 패턴).
//
// 버킷(exam-pdfs) 자체의 RLS(is_staff() 기반)는 tutor를 차단하므로, 여기서는 일반 세션 클라이언트로
// "지금 이 문항에 활성 클레임(또는 사후 검증 배정)을 갖고 있는가"만 RLS(item_explanations_select_
// tutor_claimed)로 확인한 뒤, 바이트 자체는 서비스롤 클라이언트로만 가져온다 — 버킷 정책에 tutor용
// 예외를 추가하지 않는다(설계 계획 5번 참고).
export async function GET(_request: Request, { params }: { params: { itemId: string } }) {
  const auth = await requireTutorApi();
  if (auth.error) return auth.error;

  const supabase = await createClient();
  const { data: item } = (await supabase
    .from("item_explanations")
    .select("id, exam_id")
    .eq("id", params.itemId)
    .maybeSingle()) as any;

  if (!item) {
    return Response.json(
      { ok: false, msg: "이 문항에 접근할 수 없습니다(배정이 만료됐을 수 있습니다)." },
      { status: 403 }
    );
  }

  const admin = createAdminClient();
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
