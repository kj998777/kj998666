import { requireApiRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { getExamPdfBuffer, getExamPdfMeta, getScanPdfBuffer } from "@/lib/ai/pdf";
import { createAdminClient } from "@/lib/supabase/admin";

// "디지털 시험지 PDF" 를 브라우저에서 만들 때(그림을 원본 쪽에서 오려 내야 함) 원본 시험지
// PDF의 원본 바이트가 필요해서 추가한 라우트. buildDigitizedPdf.ts 가 pdf.js로 이 바이트를
// 직접 읽어 쪽을 그림으로 렌더링한다. 시험지 원본 자체를 그대로 내려주므로(정답·해설 쪽이 남아
// 있을 수 있음) 디지털화 기능과 같은 admin 전용으로 막는다(DigitizeControl도 admin에게만 보임).
export async function GET(request: Request, { params }: { params: { code: string } }) {
  const auth = await requireApiRole("admin");
  if (auth.error) return auth.error;

  const code = decodeURIComponent(params.code);
  const supabase = await createClient();
  const { data: exam } = (await supabase.from("exams").select("id").eq("code", code).single()) as any;
  if (!exam) return Response.json({ ok: false, msg: "시험을 찾을 수 없습니다." }, { status: 404 });

  // ?scan=1 이 없으면 예전처럼 지금 원본(검토현황 문항 잘라 보기 등 — 문항 좌표가 지금 원본 기준).
  if (new URL(request.url).searchParams.get("scan") !== "1") {
    let cur: Buffer;
    try {
      cur = await getExamPdfBuffer(supabase, exam.id);
    } catch (e: any) {
      return Response.json({ ok: false, msg: e?.message || "시험지 PDF를 불러오지 못했습니다." }, { status: 400 });
    }
    return new Response(cur as any, { headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" } });
  }

  // ?scan=1 (2026-09-29): 디지털화(그림 오리기·그림 자리 고치기)는 AI가 읽은 스캔본 기준이므로, 원본으로 적용한 시험이면
  // 따로 보관한 스캔본을 준다.
  let bytes: Buffer | null = null;
  try {
    bytes = await getScanPdfBuffer(createAdminClient(), exam.id);
  } catch {
    bytes = null;
  }
  if (!bytes) {
    const meta = await getExamPdfMeta(supabase, exam.id).catch(() => null);
    const msg = meta?.replaced_with_digitized
      ? "이 시험은 예전에 '원본으로 적용'하면서 스캔본이 지워졌습니다. 디지털화 칸의 '스캔본 다시 올리기'로 처음 올렸던 스캔 PDF를 넣어 주세요(디지털화는 다시 안 해도 됩니다)."
      : "시험지 PDF를 불러오지 못했습니다.";
    return Response.json({ ok: false, msg }, { status: meta?.replaced_with_digitized ? 409 : 400 });
  }

  return new Response(bytes as any, {
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": "no-store",
    },
  });
}
