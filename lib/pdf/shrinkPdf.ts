"use client";

// 2026-10-01 원장님: "50(MB) 이상 파일 업로드 시 자동으로 압축". Supabase 무료 플랜은 파일 하나 50MB가 끝이라(0048),
// 그보다 큰 시험지 PDF는 브라우저에서 쪽마다 그림(JPEG)으로 다시 그려 작게 만든 뒤 올린다.
// 50MB를 넘는 PDF는 거의 스캔본(쪽 전체가 그림)이라 다시 그려도 잃는 것이 없다. 글자 PDF라면 글자 층이 그림이 되지만
// 문항 자리 찾기·AI 처리는 스캔본처럼 그대로 된다. 해상도는 200dpi부터 시작해 안 들어가면 150 → 120 → 96dpi로 낮춘다.

import { PDF_MAX_BYTES } from "@/lib/supabase/uploadPdf";

export type ShrinkResult = { file: Blob; shrunk: boolean; before: number; after: number; dpi?: number };

const PASSES = [
  { dpi: 200, q: 0.8 },
  { dpi: 150, q: 0.72 },
  { dpi: 120, q: 0.62 },
  { dpi: 96, q: 0.55 },
];

const mb = (n: number) => (n / 1024 / 1024).toFixed(1) + "MB";

/** 50MB를 넘으면 쪽마다 다시 그려 줄인다. 넘지 않으면 그대로 돌려준다. onMsg로 진행 상황을 알린다. */
export async function fitPdfForUpload(file: Blob, onMsg?: (m: string) => void, limit = PDF_MAX_BYTES): Promise<ShrinkResult> {
  const before = file.size;
  if (before <= limit) return { file, shrunk: false, before, after: before };
  const target = Math.floor(limit * 0.95); // 바깥 정보(쪽 구조 등) 몫을 남긴다
  const say = (m: string) => onMsg && onMsg(m);
  say(`PDF가 ${mb(before)}라 50MB 이하로 줄이는 중…`);
  // pdf-lib(약 200KB)는 50MB를 넘는 드문 경우에만 쓰므로 그때 불러온다 — 시험 화면이 처음 열릴 때 무거워지지 않게.
  const { PDFDocument } = await import("pdf-lib");
  const { loadPdfJs } = await import("@/app/(staff)/exams/[code]/buildDigitizedPdf");
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    for (const pass of PASSES) {
      const out = await PDFDocument.create();
      let total = 0;
      let over = false;
      for (let i = 1; i <= doc.numPages; i++) {
        say(`PDF 줄이는 중… ${pass.dpi}dpi · ${i}/${doc.numPages}쪽`);
        const page = await doc.getPage(i);
        const base = page.getViewport({ scale: 1 }); // 1 = 72dpi(pt)
        const vp = page.getViewport({ scale: pass.dpi / 72 });
        const cv = document.createElement("canvas");
        cv.width = Math.max(1, Math.round(vp.width));
        cv.height = Math.max(1, Math.round(vp.height));
        const ctx = cv.getContext("2d") as CanvasRenderingContext2D;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, cv.width, cv.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        const blob: Blob = await new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("쪽 그림을 만들지 못했습니다."))), "image/jpeg", pass.q));
        cv.width = cv.height = 0; // 메모리 돌려주기
        page.cleanup();
        total += blob.size;
        if (total > target) {
          over = true; // 이 해상도로는 안 들어감 → 다음 해상도
          break;
        }
        const jpg = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
        out.addPage([base.width, base.height]).drawImage(jpg, { x: 0, y: 0, width: base.width, height: base.height });
      }
      if (over) continue;
      const bytes = await out.save();
      if (bytes.length > limit) continue;
      const small = new Blob([bytes as any], { type: "application/pdf" });
      say(`PDF를 ${mb(before)} → ${mb(small.size)}로 줄였습니다(${pass.dpi}dpi).`);
      return { file: small, shrunk: true, before, after: small.size, dpi: pass.dpi };
    }
  } finally {
    try {
      await doc.destroy();
    } catch {
      /* 무시 */
    }
  }
  throw new Error(`PDF가 ${mb(before)}로 너무 커서 50MB 이하로 줄이지 못했습니다. 쪽을 나눠서 올려 주세요.`);
}
