"use client";

import { useEffect, useRef, useState } from "react";

// pdf.js를 CDN에서 불러와 원본 시험지 PDF의 문항이 있는 쪽만 이미지로 그려서 보여준다.
// "AI가 요약한 문장을 읽고 푸는 게 불편하다"는 피드백에 따라, 요약문 대신 실제로 인쇄된 문제를
// 그대로(스크린샷처럼) 보여주기 위한 화면이다(2026-09). 이후 "해당하는 문제의 사진만 띄워 달라"는
// 요청에 따라, AI가 추출 단계에서 짚어 둔 문항 영역(bbox)이 있으면 쪽 전체 대신 그 부분만 잘라
// 확대해서 보여준다(가독성 개선).
//
// app/(staff)/exams/[code]/buildDigitizedPdf.ts의 loadPdfJs/pageCv 패턴과 동일하게 pdf.js를 CDN에서
// 불러온다 — 이 프로젝트는 로컬에서 npm install이 막혀 있어 새 패키지를 추가하면 Vercel 빌드 로그로만
// 검증할 수 있으므로, 이미 실제로 검증된 방식을 그대로 재사용한다(새 npm 의존성을 추가하지 않음).
let pdfJsReady: Promise<any> | null = null;
function loadPdfJs(): Promise<any> {
  if (!pdfJsReady) {
    pdfJsReady = new Promise((resolve, reject) => {
      if ((window as any).pdfjsLib) {
        resolve((window as any).pdfjsLib);
        return;
      }
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      script.onload = () => {
        const lib = (window as any).pdfjsLib;
        lib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        resolve(lib);
      };
      script.onerror = () => reject(new Error("이미지 뷰어를 불러오지 못했습니다."));
      document.body.appendChild(script);
    });
  }
  return pdfJsReady;
}

// pdf.js Document 객체는 요청마다 새로 받기엔 비싸므로(특히 스캔본), 같은 pdfUrl에 대해서는
// 페이지를 넘길 때마다 다시 fetch/파싱하지 않고 한 번 받아둔 문서를 재사용한다.
let docCache: { url: string; doc: Promise<any> } | null = null;
async function loadDoc(pdfUrl: string): Promise<any> {
  if (docCache && docCache.url === pdfUrl) return docCache.doc;
  const promise = (async () => {
    const pdfjsLib = await loadPdfJs();
    const res = await fetch(pdfUrl, { cache: "no-store" });
    if (!res.ok) throw new Error("원본 PDF를 불러오지 못했습니다.");
    const buf = await res.arrayBuffer();
    return pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  })();
  docCache = { url: pdfUrl, doc: promise };
  try {
    await promise;
  } catch {
    docCache = null; // 실패하면 캐시해 두지 않는다(다음 시도에서 재시도할 수 있게).
  }
  return promise;
}

export type ProblemBbox = { x0: number; y0: number; x1: number; y1: number };

// AI가 짚은 영역이 문항을 딱 맞게 못 잡았을 수 있으니, 잘려 보이지 않게 쪽 크기의 2%만큼 여유를
// 두고 자른다(1000분율 기준 20).
const BBOX_PAD = 20;

/**
 * 문항의 인쇄 쪽 번호(page)와 영역(bbox)이 AI 추출 단계에서 저장돼 있으면 그 부분만 잘라 확대해
 * 바로 보여주고(가독성 개선), 없으면(기존 시험처럼 이 기능이 생기기 전에 처리된 문항, 또는 AI가
 * 잘못 짚은 경우) 1쪽부터 보여주면서 과외 선생님이 직접 쪽을 넘겨 문제를 찾을 수 있게 한다.
 * bbox 가 있어도 AI가 잘못 잘랐을 수 있으니 "전체 쪽 보기"로 언제든 되돌아갈 수 있다.
 */
export default function ProblemPageImage({
  pdfUrl,
  page,
  bbox,
}: {
  pdfUrl: string;
  page: number | null;
  bbox: ProblemBbox | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [err, setErr] = useState("");
  const [currentPage, setCurrentPage] = useState(page && page > 0 ? page : 1);
  const [numPages, setNumPages] = useState<number | null>(null);
  const knownPage = !!(page && page > 0);
  const hasBbox = !!(knownPage && bbox && bbox.x1 > bbox.x0 && bbox.y1 > bbox.y0);
  // AI가 짚어 준 문제 영역만 볼지, 쪽 전체를 볼지 — bbox가 있으면 기본은 영역만(가독성 우선).
  const [showFullPage, setShowFullPage] = useState(false);
  // 지금 이 쪽에서 실제로 자르고 있는지: bbox가 있고, 전체 보기를 안 눌렀고, 문항이 있는 쪽 그대로일 때만.
  const cropping = hasBbox && !showFullPage && currentPage === (page as number);

  useEffect(() => {
    setCurrentPage(page && page > 0 ? page : 1);
    setShowFullPage(false);
  }, [pdfUrl, page]);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        const doc = await loadDoc(pdfUrl);
        if (cancelled) return;
        setNumPages(doc.numPages);
        const target = Math.min(Math.max(1, currentPage), doc.numPages);
        if (target !== currentPage) {
          setCurrentPage(target);
          return; // currentPage가 바뀌면 이 effect가 다시 돌면서 그 쪽을 그린다.
        }
        const pg = await doc.getPage(target);
        const v1 = pg.getViewport({ scale: 1 });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

        if (cropping && bbox) {
          const x0 = Math.max(0, bbox.x0 - BBOX_PAD);
          const y0 = Math.max(0, bbox.y0 - BBOX_PAD);
          const x1 = Math.min(1000, bbox.x1 + BBOX_PAD);
          const y1 = Math.min(1000, bbox.y1 + BBOX_PAD);
          const fracW = (x1 - x0) / 1000;
          const fracH = (y1 - y0) / 1000;
          // 잘라낸 부분이 화면에서 약 1100px 너비로 보이도록 원본 렌더 배율을 역산한다(문항이
          // 작을수록 배율을 더 높여야 확대돼 보임). 너무 잘게 자르면 배율이 과해지므로 상한을 둔다.
          let scale = fracW > 0 ? 1100 / (fracW * v1.width) : 3;
          scale = Math.min(6, Math.max(1.5, scale));
          const vp = pg.getViewport({ scale });
          const full = document.createElement("canvas");
          full.width = Math.max(1, Math.ceil(vp.width));
          full.height = Math.max(1, Math.ceil(vp.height));
          const fctx = full.getContext("2d") as CanvasRenderingContext2D;
          fctx.fillStyle = "#fff";
          fctx.fillRect(0, 0, full.width, full.height);
          await pg.render({ canvasContext: fctx, viewport: vp }).promise;
          if (cancelled) return;
          const cropX = Math.round((x0 / 1000) * full.width);
          const cropY = Math.round((y0 / 1000) * full.height);
          const cropW = Math.max(1, Math.round(fracW * full.width));
          const cropH = Math.max(1, Math.round(fracH * full.height));
          canvas.width = cropW;
          canvas.height = cropH;
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, cropW, cropH);
          ctx.drawImage(full, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
        } else {
          const scale = Math.min(3, Math.max(1.5, 1400 / v1.width));
          const vp = pg.getViewport({ scale });
          canvas.width = Math.ceil(vp.width);
          canvas.height = Math.ceil(vp.height);
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await pg.render({ canvasContext: ctx, viewport: vp }).promise;
        }
        if (!cancelled) setStatus("ok");
      } catch (e: any) {
        if (!cancelled) {
          setStatus("error");
          setErr(e?.message || "문제 이미지를 불러오지 못했습니다.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfUrl, currentPage, cropping, bbox?.x0, bbox?.y0, bbox?.x1, bbox?.y1]);

  function goPage(delta: number) {
    setCurrentPage((p) => {
      const next = p + delta;
      if (next < 1) return 1;
      if (numPages && next > numPages) return numPages;
      return next;
    });
  }

  return (
    <div className="space-y-2">
      {!knownPage && status !== "error" && (
        <p className="text-xs text-amber-600">
          이 문항은 인쇄된 쪽 번호를 몰라 1쪽부터 보여드립니다. 아래에서 쪽을 넘겨 문제를 찾아 주세요.
        </p>
      )}
      <div className="border border-slate-200 rounded overflow-auto bg-slate-50">
        {status === "loading" && (
          <p className="text-sm text-slate-400 p-6 text-center">문제 이미지를 불러오는 중...</p>
        )}
        {status === "error" && (
          <p className="text-sm text-slate-500 p-4 text-center">{err} 새로고침해서 다시 시도해 주세요.</p>
        )}
        <canvas
          ref={canvasRef}
          className="max-w-full h-auto mx-auto block"
          style={{ display: status === "ok" ? "block" : "none" }}
        />
      </div>
      {status !== "error" && hasBbox && (
        <div className="flex items-center justify-center">
          <button type="button" className="btn-secondary text-xs" onClick={() => setShowFullPage((v) => !v)}>
            {showFullPage ? "문제 영역만 보기" : "전체 쪽 보기"}
          </button>
        </div>
      )}
      {status !== "error" && !cropping && (
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            className="btn-secondary"
            disabled={status === "loading" || currentPage <= 1}
            onClick={() => goPage(-1)}
          >
            ← 이전 쪽
          </button>
          <span className="text-sm text-slate-500 tabular-nums">
            {currentPage}
            {numPages ? ` / ${numPages}` : ""} 쪽
          </span>
          <button
            type="button"
            className="btn-secondary"
            disabled={status === "loading" || (!!numPages && currentPage >= numPages)}
            onClick={() => goPage(1)}
          >
            다음 쪽 →
          </button>
        </div>
      )}
    </div>
  );
}
