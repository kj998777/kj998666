import "server-only";
import { contentDispositionAttachment } from "@/lib/http/contentDisposition";

// 고3 사설 모의고사 해설지 PDF 내려주기(0053 exams.solution_pdf_path). 부르는 쪽이 권한(직원 / 산 과외선생님)을 먼저 확인한다.
export async function solutionPdfResponse(admin: any, exam: { code: string; name: string; solution_pdf_path: string | null }): Promise<Response> {
  if (!exam.solution_pdf_path) return Response.json({ ok: false, msg: "해설지 PDF가 아직 없습니다." }, { status: 404 });
  const { data, error } = await admin.storage.from("exam-pdfs").download(exam.solution_pdf_path);
  if (error || !data) return Response.json({ ok: false, msg: "해설지를 불러오지 못했습니다." }, { status: 404 });
  return new Response(await data.arrayBuffer(), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDispositionAttachment(`${exam.name}_해설지.pdf`, `solution_${exam.code}.pdf`),
      "Cache-Control": "private, max-age=300",
    },
  });
}
