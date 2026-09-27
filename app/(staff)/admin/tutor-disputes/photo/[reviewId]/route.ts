import { requireApiRole } from "@/lib/auth/requireRole";
import { createAdminClient } from "@/lib/supabase/admin";

const PHOTO_BUCKET = "tutor-review-photos";

// 과외선생님이 검토 제출에 첨부한 풀이 사진을 관리자만 열람할 수 있게 스트림한다. 버킷 자체에는
// RLS 정책을 두지 않았으므로(마이그레이션 0005 참고), 여기서 requireApiRole("admin")로 먼저 막고
// 바이트는 서비스롤 클라이언트로만 가져온다 — exam-pdfs/tutor PDF 라우트와 같은 패턴.
export async function GET(_request: Request, { params }: { params: { reviewId: string } }) {
  const auth = await requireApiRole("admin");
  if (auth.error) return auth.error;

  const admin = createAdminClient();
  const { data: review } = (await admin
    .from("tutor_item_reviews")
    .select("image_path")
    .eq("id", params.reviewId)
    .maybeSingle()) as any;

  if (!review?.image_path) {
    return Response.json({ ok: false, msg: "첨부된 사진이 없습니다." }, { status: 404 });
  }

  const { data, error } = await admin.storage.from(PHOTO_BUCKET).download(review.image_path);
  if (error || !data) {
    return Response.json({ ok: false, msg: "사진을 불러오지 못했습니다." }, { status: 404 });
  }

  const ext = (review.image_path as string).split(".").pop()?.toLowerCase();
  const contentType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  const bytes = Buffer.from(await data.arrayBuffer());

  return new Response(bytes as any, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
