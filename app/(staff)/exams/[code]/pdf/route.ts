import { requireApiRole } from "@/lib/auth/requireRole";
import { createClient } from "@/lib/supabase/server";
import { buildStampedExamPdf, type Correction } from "@/lib/ai/pdfStamp";
import { contentDispositionAttachment } from "@/lib/http/contentDisposition";

// QR·정오표 포함 시험지 PDF 다운로드. AI 비용이 들지 않는 기능이라 editor 이상이면 누구나 사용 가능.
// GET 쿼리스트링으로 옵션을 받는 이유: <form method="get">으로 만든 체크박스만으로
// 브라우저가 바로 "다운로드"를 트리거할 수 있어서(별도 클라이언트 JS 불필요).
export async function GET(request: Request, { params }: { params: { code: string } }) {
  const auth = await requireApiRole("editor");
  if (auth.error) return auth.error;

  const code = decodeURIComponent(params.code);
  const supabase = await createClient();
  const { data: exam } = (await supabase.from("exams").select("id, code, name").eq("code", code).single()) as any;
  if (!exam) return Response.json({ ok: false, msg: "시험을 찾을 수 없습니다." }, { status: 404 });

  const url = new URL(request.url);
  const cover = url.searchParams.get("cover") === "1";
  const addFixPage = url.searchParams.get("addFix") === "1";
  const excludePages = (url.searchParams.get("exclude") || "")
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);

  const { data: correctionRows } = (await supabase
    .from("exam_corrections")
    .select("item_label, issue, fix")
    .eq("exam_id", exam.id)
    .order("item_label")) as any;
  const fixes: Correction[] = ((correctionRows as any[]) ?? []).map((c) => ({
    label: c.item_label,
    issue: c.issue ?? "",
    fix: c.fix ?? "",
  }));

  const submitUrl = `${url.origin}/s/${encodeURIComponent(exam.code)}`;

  let bytes: Uint8Array;
  try {
    bytes = await buildStampedExamPdf(supabase, exam.id, {
      cover,
      addFixPage,
      excludePages,
      examName: exam.name,
      examCode: exam.code,
      submitUrl,
      fixes,
    });
  } catch (e: any) {
    return Response.json({ ok: false, msg: e?.message || "PDF를 만들지 못했습니다." }, { status: 400 });
  }

  return new Response(bytes as any, {
    headers: {
      "Content-Type": "application/pdf",
      // exam.code/exam.name에 한글·공백이 그대로 들어 있을 수 있어(배치 업로드 시 파일명을 그대로 씀)
      // ASCII가 보장된 filename=은 별도로 안전하게 만들고, 진짜 이름은 filename*=에만 담는다
      // (raw로 헤더에 넣으면 Node가 "Invalid character in header content" 예외를 던져 500이 났었음).
      "Content-Disposition": contentDispositionAttachment(`${exam.name}_${exam.code}.pdf`, `exam_${exam.id}.pdf`),
      "Cache-Control": "no-store",
    },
  });
}
