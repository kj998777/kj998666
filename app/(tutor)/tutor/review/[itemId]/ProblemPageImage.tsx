"use client";

import { useEffect, useRef, useState } from "react";

// pdf.js를 CDN에서 불러와 원본 시험지 PDF의 문항이 있는 쪽만 이미지로 그려서 보여준다.
// "AI가 요약한 문장을 읽고 푸는 게 불편하다"는 피드백에 따라, 요약문 대신 실제로 인쇄된 문제를
// 그대로(스크린샷처럼) 보여주기 위한 화면이다(2026-09).
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

/**
 * 문항의 인쇄 쪽 번호(page)가 AI 추출 단계에서 저장돼 있으면 그 쪽을 바로 보여주고, 없으면(기존
 * 시험처럼 이 기능이 생기기 전에 처리된 문항, 또는 AI가 잘못 짚은 경우) 1쪽부터 보여주면서 과외
 * 선생님이 직접 쪽을 넘겨 문제를 찾을 수 있게 한다 — "쪽 번호를 모르니 그냥 안 보여준다"보다
 * 훨씬 쓸모 있다. 쪽 번호를 아는 경우에도 AI가 잘못 짚었을 수 있으니 이전/다음 버튼은 항상 켜둔다.
 */
export default function ProblemPageImage({ pdfUrl, page }: { pdfUrl: string; page: number | null }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [err, setErr] = useState("");
  const [currentPage, setCurrentPage] = useState(page && page > 0 ? page : 1);
  const [numPages, setNumPages] = useState<number | null>(null);
  const knownPage = page && page > 0;

  useEffect(() => {
    setCurrentPage(page && page > 0 ? page : 1);
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
        const scale = Math.min(3, Math.max(1.5, 1400 / v1.width));
        const vp = pg.getViewport({ scale });
        if (cancelled) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);
        const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await pg.render({ canvasContext: ctx, viewport: vp }).promise;
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
  }, [pdfUrl, currentPage]);

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
          <p className="text-sm text-slate-500 p-4 text-center">
            {err} 위 &quot;원본 문제지 PDF 보기&quot;에서 직접 확인해 주세요.
          </p>
        )}
        <canvas
          ref={canvasRef}
          className="max-w-full h-auto mx-auto block"
          style={{ display: status === "ok" ? "block" : "none" }}
        />
      </div>
      {status !== "error" && (
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
"use client";

import { useEffect, useRef, useState } from "react";

// pdf.js를 CDN에서 불러와 원본 시험지 PDF의 문항이 있는 쪽만 이미지로 그려서 보여준다.
// "AI가 요약한 문장을 읽고 푸는 게 불편하다"는 피드백에 따라, 요약문 대신 실제로 인쇄된 문제를
// 그대로(스크린샷처럼) 보여주기 위한 화면이다(2026-09).
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

export default function ProblemPageImage({ pdfUrl, page }: { pdfUrl: string; page: number | null }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!page || page < 1) {
      setStatus("error");
      setErr("이 문항은 인쇄된 쪽 번호를 알 수 없습니다.");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const pdfjsLib = await loadPdfJs();
        const res = await fetch(pdfUrl, { cache: "no-store" });
        if (!res.ok) throw new Error("원본 PDF를 불러오지 못했습니다.");
        const buf = await res.arrayBuffer();
        const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
        if (page > doc.numPages) throw new Error("이 시험지에는 " + page + "쪽이 없습니다.");
        const pg = await doc.getPage(page);
        const v1 = pg.getViewport({ scale: 1 });
        const scale = Math.min(3, Math.max(1.5, 1400 / v1.width));
        const vp = pg.getViewport({ scale });
        if (cancelled) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);
        const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await pg.render({ canvasContext: ctx, viewport: vp }).promise;
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
  }, [pdfUrl, page]);

  if (status === "error") {
    return (
      <div className="border border-slate-200 rounded p-4 text-sm text-slate-500 text-center">
        {err} 위 &quot;원본 문제지 PDF 보기&quot;에서 직접 확인해 주세요.
      </div>
    );
  }

  return (
    <div className="border border-slate-200 rounded overflow-auto bg-slate-50">
      {status === "loading" && (
        <p className="text-sm text-slate-400 p-6 text-center">문제 이미지를 불러오는 중...</p>
      )}
      <canvas
        ref={canvasRef}
        className="max-w-full h-auto mx-auto block"
        style={{ display: status === "ok" ? "block" : "none" }}
      />
    </div>
  );
}
