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
