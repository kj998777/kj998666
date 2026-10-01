import "server-only";
import { PDFDocument } from "pdf-lib";
import { getExamPdfBuffer } from "@/lib/ai/pdf";

// 문항이 인쇄된 쪽 하나만 떼어 새 PDF로(2026-09-30 맞춤 시험지, 2026-10-01 입학테스트). 시험지 전체(정답·해설 쪽 포함)를
// 넘기지 않으려고 서버에서 그 쪽만 준다. 부르는 쪽이 "이 사람이 이 문항을 받을 수 있는지"를 먼저 확인할 것.
export async function singlePagePdf(admin: any, itemId: string): Promise<Uint8Array | null> {
  const { data: ie } = await admin.from("item_explanations").select("exam_id, source_page").eq("id", itemId).maybeSingle();
  if (!ie?.source_page) return null;
  let src: Buffer;
  try {
    src = await getExamPdfBuffer(admin, ie.exam_id);
  } catch {
    return null;
  }
  const doc = await PDFDocument.load(src, { ignoreEncryption: true });
  const idx = Number(ie.source_page) - 1;
  if (idx < 0 || idx >= doc.getPageCount()) return null;
  const out = await PDFDocument.create();
  const [pg] = await out.copyPages(doc, [idx]);
  out.addPage(pg);
  return await out.save();
}

/**
 * 2026-10-01 느린 화면 줄이기: PDF 바이트에서 n쪽만 떼어 새 PDF로(전체 쪽 수도 같이). 휴대폰으로 검토할 때
 * 문항마다 시험지 전체(스캔본은 수 MB)를 받던 것을 그 쪽 하나만 받게 한다. n이 범위 밖이면 null.
 */
export async function pdfPageOf(src: Uint8Array | Buffer, n: number): Promise<{ bytes: Uint8Array; total: number } | null> {
  const doc = await PDFDocument.load(src, { ignoreEncryption: true });
  const total = doc.getPageCount();
  const idx = Math.floor(n) - 1;
  if (!Number.isFinite(idx) || idx < 0 || idx >= total) return null;
  const out = await PDFDocument.create();
  const [pg] = await out.copyPages(doc, [idx]);
  out.addPage(pg);
  return { bytes: await out.save(), total };
}

/** ?page=N 응답 — 쪽 하나와 전체 쪽 수(X-Page-Count). 같은 쪽을 다시 열면 브라우저가 5분 동안 재사용한다. */
export function pageResponse(r: { bytes: Uint8Array; total: number }): Response {
  return new Response(r.bytes as any, {
    headers: {
      "Content-Type": "application/pdf",
      "X-Page-Count": String(r.total),
      "Cache-Control": "private, max-age=300",
    },
  });
}
