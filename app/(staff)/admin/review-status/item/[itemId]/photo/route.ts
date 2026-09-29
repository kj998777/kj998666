import { requireApiRole } from "@/lib/auth/requireRole";
import { createAdminClient } from "@/lib/supabase/admin";

// 관리자가 문항 화면에서 올린 풀이 사진 보기(관리자 전용). ?name=<파일 이름>
export async function GET(request: Request, { params }: { params: { itemId: string } }) {
  const auth = await requireApiRole("admin");
  if (auth.error) return auth.error;
  const name = new URL(request.url).searchParams.get("name") || "";
  if (!/^[0-9a-f-]{36}$/i.test(params.itemId) || !/^[0-9]+\.[a-z0-9]{1,5}$/i.test(name)) {
    return Response.json({ ok: false, msg: "잘못된 요청입니다." }, { status: 400 });
  }
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from("tutor-review-photos").download(`admin/${params.itemId}/${name}`);
  if (error || !data) return Response.json({ ok: false, msg: "사진을 찾을 수 없습니다." }, { status: 404 });
  return new Response(data as any, {
    headers: { "Content-Type": data.type || "image/jpeg", "Cache-Control": "private, max-age=300" },
  });
}
