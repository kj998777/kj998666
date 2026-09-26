import { requireApiRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { getExamPdfBuffer } from "@/lib/ai/pdf";

// "디지털 시험지 PDF" 를 브라우저에서 만들 때(그림을 원본 쪽에서 오려 내야 함) 원본 시험지
// PDF의 원본 바이트가 필요해서 추가한 라우트. buildDigitizedPdf.ts 가 pdf.js로 이 바이트를
// 직접 읽어 쪽을 그림으로 렌더링한다. 시험지 원본 자체를 그대로 내려주므로(정답·해설 쪽이 남아
// 있을 수 있음) 디지털화 기능과 같은 admin 전용으로 막는다(DigitizeControl도 admin에게만 보임).
export async function GET(_request: Request, { params }: { params: { code: string } }) {
  const auth = await requireApiRole("admin");
  if (auth.error) return auth.error;

  const code = decodeURIComponent(params.code);
  const supabase = await createClient();
  const { data: exam } = (await supabase.from("exams").select("id").eq("code", code).single()) as any;
  if (!exam) return Response.json({ ok: false, msg: "시험을 찾을 수 없습니다." }, { status: 404 });

  let bytes: Buffer;
  try {
    bytes = await getExamPdfBuffer(supabase, exam.id);
  } catch (e: any) {
    return Response.json({ ok: false, msg: e?.message || "시험지 PDF를 불러오지 못했습니다." }, { status: 400 });
  }

  return new Response(bytes as any, {
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": "no-store",
    },
  });
}
