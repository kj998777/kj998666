import "server-only";
import { countPdfPages } from "./pdfMeta";

// 시험지 원본 PDF 저장/조회. Apps Script의 '시험지PDF' 시트(40000자 base64 청크 방식)를
// Supabase Storage 버킷(exam-pdfs)의 진짜 파일로 대체 — 훨씬 단순하고 용량 제한도 없다.

const BUCKET = "exam-pdfs";

// Client 타입을 any로 두는 이유는 lib/ai/settings.ts 상단 주석 참고(createServerClient와
// supabase-js의 SupabaseClient 타입이 대입되지 않는 실제 빌드 실패를 겪었음).
type Client = any;

function pathOf(examId: string): string {
  return `${examId}.pdf`;
}

/**
 * 버그 수정(2026-09-28): 브라우저 직접 업로드는 이제 올릴 때마다 새 경로(`<examId>/<시각>.pdf`)에
 * 올린다(lib/supabase/uploadPdf.ts 참고 — 같은 경로에 덮어쓰면 캐시 때문에 예전 파일이 내려오는 문제).
 * 그중 가장 최근 것을 고른다. 버전 폴더가 비어 있으면 예전 방식 경로(`<examId>.pdf`).
 */
async function latestUploadedPath(client: Client, examId: string): Promise<{ path: string; older: string[] }> {
  const { data } = await client.storage.from(BUCKET).list(examId, { limit: 100 });
  const versions = ((data as any[]) ?? [])
    .map((o) => String(o.name))
    .filter((n) => /^\d+\.pdf$/.test(n))
    .sort((a, b) => Number(b.slice(0, -4)) - Number(a.slice(0, -4)));
  if (!versions.length) return { path: pathOf(examId), older: [] };
  return {
    path: `${examId}/${versions[0]}`,
    older: [...versions.slice(1).map((n) => `${examId}/${n}`), pathOf(examId)],
  };
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

/**
 * #2(2026-09-28): 브라우저가 Supabase Storage(exam-pdfs 버킷)에 곧바로 올린(=이미 존재하는) PDF의
 * 뒷정리를 한다 — Vercel 서버리스 함수의 요청 본문 크기 제한(약 4.5MB)을 피하려고 PDF 바이트를 더
 * 이상 서버 액션(FormData)으로 받지 않고, 브라우저가 직접 Storage에 올린 뒤 이 함수를 부르는 구조로
 * 바꿨다(lib/supabase/uploadPdf.ts, app/(staff)/exams/ai-actions.ts). saveExamPdf와 달리 pdf 바이트를
 * 인자로 받지 않고, 이미 올라간 파일을 다시 내려받아(용량이 작으므로 서버 자원 부담은 적음) 쪽수만
 * 센 뒤 exam_pdf_meta를 갱신한다.
 *
 * source: "digitized"면 디지털화 결과를 "원본으로 적용"한 경우다 — 이때는 스캔본이 아니라 새로
 * 조판한 깨끗한 버전이므로 is_scanned를 false로, replaced_with_digitized를 true로 남긴다.
 */
export async function finalizePdfUpload(
  client: Client,
  examId: string,
  meta: { isScanned: boolean | null; uploadedBy: string; source?: "upload" | "digitized" }
): Promise<{ pages: number | null }> {
  const { path, older } = await latestUploadedPath(client, examId);
  const { data, error } = await client.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error("방금 올린 PDF를 서버에서 확인하지 못했습니다: " + (error?.message || "?"));
  const buf = Buffer.from(await data.arrayBuffer());
  const pages = await countPdfPages(buf);
  const isDigitized = meta.source === "digitized";
  const { error: metaErr } = await (client.from("exam_pdf_meta") as any).upsert(
    {
      exam_id: examId,
      storage_path: path,
      pages,
      is_scanned: isDigitized ? false : meta.isScanned,
      uploaded_by: meta.uploadedBy,
      uploaded_at: new Date().toISOString(), // 2026-09-29: 다시 올릴 때도 시각을 갱신(전에는 처음 올린 시각에 멈춰 있었음)
      replaced_with_digitized: isDigitized,
    },
    { onConflict: "exam_id" }
  );
  if (metaErr) throw metaErr;
  // 이전 버전 정리(관리자만 삭제 권한이 있음 — 편집자가 올린 경우 등 실패해도 무시).
  if (older.length) {
    try {
      await client.storage.from(BUCKET).remove(older);
    } catch {
      /* 무시 */
    }
  }
  return { pages };
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
