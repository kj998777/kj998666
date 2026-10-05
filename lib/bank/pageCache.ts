import "server-only";
import { PDFDocument } from "pdf-lib";
import { getExamPdfBuffer, getExamPdfMeta } from "@/lib/ai/pdf";
import { hash32 } from "@/lib/similar/recommend";

// 2026-10-05 Supabase 사용량: 무료 한도(Cached Egress 5GB)를 넘었다(10/1~10/2에 하루 2~4GB). 과외 검토·맞춤 시험지·
// 입학테스트·오답 유사문제 화면이 문항 쪽 하나를 보여 줄 때마다 서버가 Storage에서 시험지 PDF 전체(스캔본은 수 MB)를
// 새로 받았기 때문이다. 이제는 시험지 하나(같은 버전)당 처음 한 번만 전체를 받아 모든 쪽을 한 쪽짜리 PDF로 잘라
// exam-pdfs 버킷의 _pages/<시험 id>/<버전>/ 아래에 저장해 두고, 그다음부터는 그 작은 파일만 받는다.
//  - 버전 = exam_pdf_meta.storage_path + uploaded_at (새로 올리거나 디지털 시험지를 원본으로 적용하면 바뀜 → 새로 자름)
//  - 파일 이름 "<쪽>_of_<전체 쪽 수>.pdf" — 목록 조회(전송량 거의 없음)로 전체 쪽 수도 함께 안다.
//  - 저장이 실패해도(권한·용량) 예전처럼 전체에서 잘라 돌려준다.

const BUCKET = "exam-pdfs";

function versionDir(examId: string, meta: any): string {
  const v = hash32(String(meta?.storage_path ?? "") + "|" + String(meta?.uploaded_at ?? "")).toString(36);
  return `_pages/${examId}/${v}`;
}

async function splitAll(src: Uint8Array | Buffer): Promise<Uint8Array[]> {
  const doc = await PDFDocument.load(src, { ignoreEncryption: true });
  const out: Uint8Array[] = [];
  for (let i = 0; i < doc.getPageCount(); i++) {
    const one = await PDFDocument.create();
    const [pg] = await one.copyPages(doc, [i]);
    one.addPage(pg);
    out.push(await one.save());
  }
  return out;
}

/** 시험지 n쪽(1부터)만 담은 PDF와 전체 쪽 수. 없는 쪽이면 null. 시험지가 없으면 예외. */
export async function examPage(admin: any, examId: string, n: number): Promise<{ bytes: Uint8Array; total: number } | null> {
  const want = Math.floor(Number(n));
  if (!Number.isFinite(want) || want < 1) return null;
  const meta = await getExamPdfMeta(admin, examId).catch(() => null);
  if (!meta) throw new Error("시험지 PDF가 저장되어 있지 않습니다.");
  const dir = versionDir(examId, meta);

  // 1) 잘라 둔 쪽이 있으면 그것만
  try {
    const { data: files } = await admin.storage.from(BUCKET).list(dir, { limit: 1000 });
    const names: string[] = ((files as any[]) ?? []).map((f) => String(f.name));
    const m = names.map((x) => /^(\d+)_of_(\d+)\.pdf$/.exec(x)).find((r) => r && Number(r[1]) === want);
    const anyName = names.map((x) => /^(\d+)_of_(\d+)\.pdf$/.exec(x)).find(Boolean);
    if (anyName && want > Number(anyName[2])) return null;
    if (m) {
      const { data, error } = await admin.storage.from(BUCKET).download(`${dir}/${m[0]}`);
      if (!error && data) return { bytes: new Uint8Array(await data.arrayBuffer()), total: Number(m[2]) };
    }
  } catch {
    /* 목록·다운로드 실패 → 아래에서 전체로 */
  }

  // 2) 처음이면 전체를 한 번 받아 모든 쪽을 잘라 저장
  const src = await getExamPdfBuffer(admin, examId);
  const pages = await splitAll(src);
  const total = pages.length;
  await Promise.all(
    pages.map((bytes, i) =>
      admin.storage
        .from(BUCKET)
        .upload(`${dir}/${i + 1}_of_${total}.pdf`, Buffer.from(bytes), { contentType: "application/pdf", upsert: true })
        .catch(() => null)
    )
  );
  if (want > total) return null;
  return { bytes: pages[want - 1], total };
}

/** 문항 하나가 인쇄된 쪽(source_page)만 — 맞춤 시험지·입학테스트용(lib/bank/singlePage.ts singlePagePdf와 같은 결과) */
export async function itemPage(admin: any, itemId: string): Promise<Uint8Array | null> {
  const { data: ie } = await admin.from("item_explanations").select("exam_id, source_page").eq("id", itemId).maybeSingle();
  if (!ie?.source_page) return null;
  try {
    return (await examPage(admin, ie.exam_id, Number(ie.source_page)))?.bytes ?? null;
  } catch {
    return null;
  }
}
