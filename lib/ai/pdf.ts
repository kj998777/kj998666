import "server-only";

// 시험지 원본 PDF 저장/조회. Apps Script의 '시험지PDF' 시트(40000자 base64 청크 방식)를
// Supabase Storage 버킷(exam-pdfs)의 진짜 파일로 대체 — 훨씬 단순하고 용량 제한도 없다.

const BUCKET = "exam-pdfs";

// Client 타입을 any로 두는 이유는 lib/ai/settings.ts 상단 주석 참고(createServerClient와
// supabase-js의 SupabaseClient 타입이 대입되지 않는 실제 빌드 실패를 겪었음).
type Client = any;

function pathOf(examId: string): string {
  return `${examId}.pdf`;
}

export async function saveExamPdf(
  client: Client,
  examId: string,
  pdf: Buffer,
  meta: { pages: number | null; isScanned: boolean | null; uploadedBy: string }
): Promise<void> {
  const path = pathOf(examId);
  const { error: upErr } = await client.storage.from(BUCKET).upload(path, pdf, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (upErr) throw upErr;
  const { error: metaErr } = await (client.from("exam_pdf_meta") as any).upsert(
    {
      exam_id: examId,
      storage_path: path,
      pages: meta.pages,
      is_scanned: meta.isScanned,
      uploaded_by: meta.uploadedBy,
    },
    { onConflict: "exam_id" }
  );
  if (metaErr) throw metaErr;
}

export async function getExamPdfMeta(client: Client, examId: string) {
  const { data, error } = (await client.from("exam_pdf_meta").select("*").eq("exam_id", examId).maybeSingle()) as any;
  if (error) throw error;
  return data;
}

export async function getExamPdfBuffer(client: Client, examId: string): Promise<Buffer> {
  const meta = await getExamPdfMeta(client, examId);
  if (!meta) throw new Error("시험지 PDF가 저장되어 있지 않습니다.");
  const { data, error } = await client.storage.from(BUCKET).download(meta.storage_path);
  if (error || !data) throw new Error("저장된 시험지 PDF를 불러오지 못했습니다: " + (error?.message || "?"));
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
