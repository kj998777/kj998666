import { createAdminClient } from "@/lib/supabase/admin";

// 임시 디버그 엔드포인트 — "/s/[code]"에서 존재하는 시험이 "존재하지 않음"으로 나오는 버그를
// 원인 규명하기 위해 서비스롤 클라이언트가 실제로 무엇을 보는지 그대로 노출한다.
// 원인을 찾은 뒤 반드시 삭제할 것.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "DG2025";

  const envInfo = {
    hasUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    hasServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    urlHost: (() => {
      try {
        return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "").host;
      } catch {
        return null;
      }
    })(),
  };

  let admin;
  try {
    admin = createAdminClient();
  } catch (e: any) {
    return Response.json({ step: "createAdminClient", error: e?.message, envInfo });
  }

  const examRes = await admin.from("exams").select("id, code, name, status").eq("code", code).single();
  const allExamsRes = await admin.from("exams").select("code, status").order("created_at", { ascending: false }).limit(5);

  return Response.json({
    envInfo,
    code,
    examRes: { data: examRes.data, error: examRes.error },
    allExamsRes: { data: allExamsRes.data, error: allExamsRes.error },
  });
}
