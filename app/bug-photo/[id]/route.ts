import { getSessionAndRole } from "@/lib/auth/requireRole";
import { createAdminClient } from "@/lib/supabase/admin";
import { BUG_PHOTO_BUCKET } from "@/lib/bugs";

export const dynamic = "force-dynamic";

// 버그 신고 스크린샷 보기(2026-09-29). 관리자 또는 그 신고를 보낸 본인만 볼 수 있다.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const session = await getSessionAndRole();
  if (!session) return Response.json({ ok: false, msg: "로그인이 필요합니다." }, { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return Response.json({ ok: false, msg: "잘못된 요청입니다." }, { status: 400 });

  const admin = createAdminClient();
  const { data: row } = (await (admin.from("bug_reports") as any)
    .select("reporter_id, photo_path")
    .eq("id", params.id)
    .maybeSingle()) as any;
  if (!row || !row.photo_path) return Response.json({ ok: false, msg: "사진을 찾을 수 없습니다." }, { status: 404 });
  if (session.role !== "admin" && row.reporter_id !== session.userId) {
    return Response.json({ ok: false, msg: "볼 수 있는 권한이 없습니다." }, { status: 403 });
  }

  const { data, error } = await admin.storage.from(BUG_PHOTO_BUCKET).download(row.photo_path);
  if (error || !data) return Response.json({ ok: false, msg: "사진을 찾을 수 없습니다." }, { status: 404 });
  return new Response(data as any, {
    headers: { "Content-Type": data.type || "image/jpeg", "Cache-Control": "private, max-age=300" },
  });
}
