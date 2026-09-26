// 브라우저에서 "디지털 시험지" PDF를 만든다.
//
// AI가 쪽마다 옮겨 적은 글자·수식·그림 위치(JSON, lib/ai/digitize.ts가 digitized_pages에 저장한
// 결과, /exams/[code]/digitized 라우트로 읽음)를 학원 양식(2단 편집, A4)으로 다시 조판해
// "그림으로 된"(글자를 고를 수 없는) PDF를 만든다. 기존 구글 Apps Script 시스템
// (claude/teacher-report-app.md의 dgBuild/dgItemHtml/dgPack 등)을 그대로 포팅한 것 — 로직은
// 바뀐 게 없고, AI 결과 데이터의 필드 이름만 이 사이트의 실제 스키마(DG_TOOL, lib/ai/prompts.ts)에
// 맞게 옮겼다(예전 Apps Script는 시트 저장 용량 때문에 k/t/s/i 같은 짧은 키로 다시 압축했었지만,
// 여기는 Postgres JSONB라 그럴 필요가 없어 DG_TOOL 스키마의 원래 키(kind/title/items/label/
// stem/box_title/box_lines/choices/figures/unsure 등)를 그대로 쓴다).
//
// 문항 순서대로 단(왼쪽→오른쪽, 2단)을 채우고(dgPack), 그림은 원본 PDF 쪽에서 좌표
// (1000×1000 기준 상대 좌표)로 오려 붙이고(pdf.js로 원본 쪽을 그려 캔버스에서 자름), 수식은
// KaTeX로 렌더링한다. 최종 조판 결과는 감춰 둔 DOM → html2canvas(html2pdf.js 경유) → JPEG →
// pdf-lib PDF 쪽 순서로 만든다.
//
// 외부 라이브러리(KaTeX·html2pdf.js·pdf.js)는 npm 패키지로 번들하지 않고 예전 시스템과 같은
// 방식으로 CDN에서 필요할 때만 <script> 태그로 불러온다 — 이 개발 환경은 npm install이 막혀
// 있어 새 패키지를 추가하면 로컬에서 빌드를 검증할 수 없고, pdf.js는 최신 버전이 ESM 전용이라
// webpack 번들 안에서 동적 import(URL)로 불러오면 빌드 시점에 문제가 될 수 있어(webpackIgnore
// 매직 코멘트가 필요) 더 안전한 예전 방식(UMD `<script>` 전역 변수)을 그대로 쓴다.

import { PDFDocument } from "pdf-lib";

// ---------------------------------------------------------------------
// AI 결과 데이터 타입 (DG_TOOL, lib/ai/prompts.ts 와 같은 모양)
// ---------------------------------------------------------------------

type DgFigure = { x0: number; y0: number; x1: number; y1: number; where?: "stem" | "end" };
type DgItem = {
  type: "question" | "text";
  label?: string;
  points?: number | null;
  stem?: string;
  box_title?: string;
  box_lines?: string[];
  choices?: string[];
  figures?: DgFigure[];
  unsure?: string;
};
type DgPageData = { kind: string; title?: string; subtitle?: string; items?: DgItem[] };
type DgPage = { page_no: number; data: DgPageData };
type DigitizedResponse = { exam: { code: string; name: string }; pages: DgPage[] };

type CroppedImg = { src: string; dw: number; dh: number; w: "stem" | "end" };
type PackItem = { it: DgItem; pg: number; imgs?: CroppedImg[] };

export type BuildProgress = (message: string) => void;
export type BuildResult = { bytes: Uint8Array; pages: number; items: number; figs: number; figErrors: number };

// ---------------------------------------------------------------------
// 레이아웃 상수 (예전 시스템의 DGL 그대로: A4를 96dpi로 본 픽셀값)
// ---------------------------------------------------------------------

const DGL = { W: 794, H: 1123, MX: 44, GAP: 30, IND: 26, TOP: 44, BOT: 56 };
const DGL_CW = (DGL.W - 2 * DGL.MX - DGL.GAP) / 2; // 단(칼럼) 너비 = 338
const DG_CIRC = ["①", "②", "③", "④", "⑤", "⑥"];

// ---------------------------------------------------------------------
// 잡다한 도우미
// ---------------------------------------------------------------------

function esc(s: unknown): string {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function r2(x: number): number {
  return Math.round((x + 1e-9) * 100) / 100;
}
function fmt(x: number): string {
  return String(r2(x));
}
function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 60));
}

// ---------------------------------------------------------------------
// 외부 라이브러리 CDN 로드 (세션당 한 번만, 전역 변수로 캐시)
// ---------------------------------------------------------------------

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`외부 도구를 불러오지 못했습니다: ${src}`));
    document.head.appendChild(script);
  });
}
function loadStylesheet(href: string): void {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

let katexReady: Promise<any> | null = null;
function loadKatex(): Promise<any> {
  if (!katexReady) {
    katexReady = (async () => {
      if ((window as any).katex) return (window as any).katex;
      loadStylesheet("https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.11/katex.min.css");
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.11/katex.min.js");
      return (window as any).katex;
    })();
  }
  return katexReady;
}

let html2pdfReady: Promise<any> | null = null;
function loadHtml2Pdf(): Promise<any> {
  if (!html2pdfReady) {
    html2pdfReady = (async () => {
      if ((window as any).html2pdf) return (window as any).html2pdf;
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js");
      return (window as any).html2pdf;
    })();
  }
  return html2pdfReady;
}

let pdfJsReady: Promise<any> | null = null;
function loadPdfJs(): Promise<any> {
  if (!pdfJsReady) {
    pdfJsReady = (async () => {
      if ((window as any).pdfjsLib) return (window as any).pdfjsLib;
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js");
      const lib = (window as any).pdfjsLib;
      lib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      return lib;
    })();
  }
  return pdfJsReady;
}

// ---------------------------------------------------------------------
// 조판 CSS (예전 Teacher.html의 .dg* 규칙 그대로) — 한 번만 <style>로 넣는다
// ---------------------------------------------------------------------

let stylesInjected = false;
function injectDigitizeStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const css = `
.dgpg{position:relative;width:794px;height:1123px;background:#fff;color:#111827;overflow:hidden;font-family:'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR','Noto Sans CJK KR',sans-serif;font-size:13.5px;line-height:1.8}
.dgpg *{box-sizing:border-box}
.dgt{position:absolute;left:44px;width:706px;text-align:center}
.dgt1{font-size:22px;font-weight:700;line-height:1.3}
.dgt2{font-size:14px;color:#374151;margin-top:3px}
.dgt3{margin-top:10px;padding:5px 0;border-top:1.5px solid #111827;border-bottom:1px solid #9ca3af;font-size:12px;color:#4b5563;text-align:right;letter-spacing:.02em}
.dgt3 i{display:inline-block;width:52px;border-bottom:1px solid #6b7280;margin:0 8px 0 4px;height:12px}
.dgt3 i.w{width:90px}
.dgrh{position:absolute;left:44px;width:706px;top:26px;font-size:11px;color:#6b7280;border-bottom:1px solid #d1d5db;padding-bottom:3px}
.dgpf{position:absolute;left:0;width:794px;bottom:24px;text-align:center;font-size:11px;color:#6b7280}
.dgcols{position:absolute;left:44px;width:706px}
.dgc0,.dgc1{position:absolute;top:0;width:338px}
.dgc0{left:0}.dgc1{left:368px}
.dgsep{position:absolute;left:353px;top:0;bottom:0;width:1px;background:#9ca3af}
.dgq{padding-bottom:32px}
.dgx{padding-bottom:22px;font-weight:700}
.dgln{margin-top:7px}
.dgln.dgsub{margin-top:14px}
.dgs{padding-left:26px;text-indent:-26px}
.dgs .dgn{display:inline-block;width:26px;text-indent:0;font-weight:700}
.dgl{font-weight:700;margin-bottom:4px}
.dgp{font-weight:700;white-space:nowrap}
.dgi{margin-left:26px}
.dgb{border:1px solid #374151;padding:9px 12px;margin-top:12px}
.dgb>div+div{margin-top:5px}
.dgbt{text-align:center;font-weight:700;margin-bottom:7px}
.dgf{margin-top:12px;text-align:center}
.dgf img{display:inline-block;vertical-align:top}
.dgc{margin-top:12px}
.dgo{display:inline-block;vertical-align:top;padding-right:6px;padding-bottom:4px}
.dgc.c5 .dgo{width:20%}.dgc.c2 .dgo{width:50%}.dgc.c1 .dgo{width:100%}
.dgc .dgo b{font-weight:400}
#dg-measure{position:absolute;left:0;top:0;width:338px;visibility:hidden;font-family:'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR','Noto Sans CJK KR',sans-serif;font-size:13.5px;line-height:1.8;color:#111827}
#dg-measure *{box-sizing:border-box}
`;
  const style = document.createElement("style");
  style.id = "dg-pdf-inline-styles";
  style.textContent = css;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------
// 문항 하나를 HTML로 (예전 dgItemHtml)
// ---------------------------------------------------------------------

function dgPlainLen(s: string): number {
  // 선택지 한 칸이 차지할 폭(px) 어림: 수식은 기호 좌우 여백까지 넉넉히, 한글은 글자당 13.5px
  let p = String(s).split("$");
  if (p.length % 2 === 0) p = [String(s)];
  let w = 0;
  for (let i = 0; i < p.length; i++) {
    let t = p[i];
    if (i % 2 === 1) {
      t = t
        .replace(/\\(?:le|ge|leq|geq|ne|neq|approx)(?![a-zA-Z])/g, "=")
        .replace(/\\(?:times|div|pm|cdot)(?![a-zA-Z])/g, "+")
        .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (_m, a, b) => (a.length > b.length ? a : b))
        .replace(/\\[a-zA-Z]+/g, "x")
        .replace(/[{}^_\\\s]/g, "");
      for (let j = 0; j < t.length; j++) {
        const ch = t.charAt(j);
        w += /[<>=]/.test(ch) ? 22 : ch === "+" ? 20 : ch === "-" ? (j > 0 && /[0-9a-zA-Z)]/.test(t.charAt(j - 1)) ? 20 : 13) : /[0-9]/.test(ch) ? 8.5 : 9.5;
      }
    } else {
      for (let j = 0; j < t.length; j++) {
        const ch = t.charAt(j);
        w += /\s/.test(ch) ? 4 : /[ᄀ-㆏가-힯　-鿿]/.test(ch) ? 13.5 : 7.5;
      }
    }
  }
  return w;
}

function dgTex(katex: any, t: string | null | undefined): string {
  // 글 → HTML: $…$ 는 KaTeX 수식, 줄바꿈은 <br>, 나머지는 이스케이프
  const s = String(t == null ? "" : t);
  let parts = s.split("$");
  if (parts.length % 2 === 0) parts = [s]; // $ 가 홀수 개면 수식으로 보지 않고 글자 그대로
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      try {
        out.push(katex.renderToString(parts[i], { throwOnError: false }));
      } catch {
        out.push(esc(parts[i]));
      }
    } else {
      out.push(esc(parts[i]).replace(/\n/g, "<br>"));
    }
  }
  return out.join("");
}

function dgLines(s: string | null | undefined): string[] {
  // 글을 줄로 나눔: 수식($…$) 안의 줄바꿈은 나누지 않고, $ 가 홀수 개면 나누지 않음. 빈 줄은 뺌
  const t = String(s == null ? "" : s);
  if (((t.match(/\$/g) || []).length) % 2) return [t];
  const out: string[] = [];
  let cur = "";
  let inM = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t.charAt(i);
    if (ch === "$") inM = !inM;
    if (ch === "\n" && !inM) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.filter((l) => l.trim() !== "");
}

function dgItemHtml(katex: any, it: DgItem, imgs: CroppedImg[]): string {
  if (it.type === "text") return `<div class="dgx">${dgTex(katex, it.stem)}</div>`;
  const lab = it.label ? esc(it.label) : "";
  const hang = !!(it.label && it.label.length <= 4);
  const ind = hang ? " dgi" : "";
  const pts = it.points != null ? ` <span class="dgp">[${fmt(it.points)}점]</span>` : "";
  const lines = dgLines(it.stem);
  const last = lines.length - 1;

  function moreLines(): string {
    let o = "";
    for (let li = 1; li <= last; li++) {
      const isSub = /^\s*(?:\(\d{1,2}\)|\d{1,2}\)|\([가-하]\)|[가-하]\)|[ㄱ-ㅎ]\.)/.test(lines[li]);
      o += `<div class="dgln${ind}${isSub ? " dgsub" : ""}">${dgTex(katex, lines[li])}${li === last ? pts : ""}</div>`;
    }
    return o;
  }
  function fig(where: "stem" | "end"): string {
    return imgs
      .filter((m) => m.w === where)
      .map((m) => `<div class="dgf${ind}"><img src="${m.src}" style="width:${Math.round(m.dw)}px;height:${Math.round(m.dh)}px"></div>`)
      .join("");
  }

  let h = '<div class="dgq">';
  if (hang) h += `<div class="dgs"><b class="dgn">${lab}.</b>${dgTex(katex, lines[0] || "")}${last <= 0 ? pts : ""}</div>${moreLines()}`;
  else h += (lab ? `<div class="dgl">${lab}</div>` : "") + `<div>${dgTex(katex, lines[0] || "")}${last <= 0 ? pts : ""}</div>${moreLines()}`;

  if (it.box_lines && it.box_lines.length) {
    h += `<div class="dgb${ind}">${it.box_title ? `<div class="dgbt">${dgTex(katex, it.box_title)}</div>` : ""}${it.box_lines
      .map((l) => `<div>${dgTex(katex, l)}</div>`)
      .join("")}</div>`;
  }
  h += fig("stem");
  if (it.choices && it.choices.length) {
    let mx = 0;
    it.choices.forEach((c) => {
      mx = Math.max(mx, dgPlainLen(c));
    });
    const cls = mx <= 47 && it.choices.length <= 5 ? "c5" : mx <= 145 ? "c2" : "c1";
    h += `<div class="dgc ${cls}${ind}">${it.choices
      .map((c, i) => `<span class="dgo"><b>${DG_CIRC[i] ?? ""}</b> ${dgTex(katex, c)}</span>`)
      .join("")}</div>`;
  }
  h += fig("end");
  return h + "</div>";
}

// ---------------------------------------------------------------------
// 그림 오리기 (원본 쪽 캔버스에서 흰 가장자리 다듬기)
// ---------------------------------------------------------------------

function dgTrim(cv: HTMLCanvasElement): HTMLCanvasElement {
  const w = cv.width;
  const h = cv.height;
  const ctx = cv.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
  const d = ctx.getImageData(0, 0, w, h).data;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      if (d[p] * 0.3 + d[p + 1] * 0.59 + d[p + 2] * 0.11 < 215) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0 || (x1 - x0 + 1) * (y1 - y0 + 1) < w * h * 0.03) return cv;
  const m = 6;
  x0 = Math.max(0, x0 - m);
  y0 = Math.max(0, y0 - m);
  x1 = Math.min(w - 1, x1 + m);
  y1 = Math.min(h - 1, y1 + m);
  const c2 = document.createElement("canvas");
  c2.width = x1 - x0 + 1;
  c2.height = y1 - y0 + 1;
  (c2.getContext("2d") as CanvasRenderingContext2D).drawImage(cv, x0, y0, c2.width, c2.height, 0, 0, c2.width, c2.height);
  return c2;
}

// ---------------------------------------------------------------------
// 문항을 읽는 순서대로 단(칼럼)에 채우기 (예전 dgPack)
// ---------------------------------------------------------------------

function dgPack(
  items: PackItem[],
  hs: number[],
  capFirst: number,
  capFull: number
): { cols: number[][]; sc: Record<number, number> } {
  const cols: number[][] = [];
  let cur: number[] = [];
  let curH = 0;
  const sc: Record<number, number> = {};
  function cap(ci: number): number {
    return ci < 2 ? capFirst : capFull;
  }
  for (let i = 0; i < items.length; i++) {
    let h = hs[i];
    let need = h;
    if (items[i].it.type === "text" && i + 1 < items.length) need = h + hs[i + 1]; // 안내글이 단 맨 아래에 홀로 남지 않게
    if (curH > 0 && curH + need > cap(cols.length)) {
      cols.push(cur);
      cur = [];
      curH = 0;
    }
    const c = cap(cols.length);
    if (h > c) {
      sc[i] = Math.max(0.55, c / h);
      h = Math.min(h, c);
    }
    cur.push(i);
    curH += h;
    hs[i] = h;
  }
  if (cur.length) cols.push(cur);
  return { cols, sc };
}

// ---------------------------------------------------------------------
// 메인: 디지털 시험지 PDF 만들기
// ---------------------------------------------------------------------

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin" });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    // ignore
  }
  if (!res.ok) throw new Error((body && body.msg) || `요청에 실패했습니다 (${res.status}).`);
  return body as T;
}

export async function buildDigitizedPdf(code: string, examName: string, onProgress?: BuildProgress): Promise<BuildResult> {
  const tick = (m: string) => onProgress && onProgress(m);

  tick("디지털 시험지 데이터를 불러오는 중…");
  const g = await fetchJson<DigitizedResponse>(`/exams/${encodeURIComponent(code)}/digitized`);
  if (!g.pages || !g.pages.length) throw new Error("아직 디지털화된 쪽이 없습니다.");

  tick("시험지 원본을 불러오는 중…");
  const pdfRes = await fetch(`/exams/${encodeURIComponent(code)}/original-pdf`, { credentials: "same-origin" });
  if (!pdfRes.ok) {
    let msg = "시험지 원본 PDF를 불러오지 못했습니다.";
    try {
      const j = await pdfRes.json();
      if (j && j.msg) msg = j.msg;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  const srcBuf = await pdfRes.arrayBuffer();

  tick("PDF·수식 도구를 불러오는 중…");
  const [katex, pdfjsLib] = await Promise.all([loadKatex(), loadPdfJs(), loadHtml2Pdf()]);

  const pagesWithQuestions = g.pages.filter((p) => p.data && p.data.kind === "questions" && p.data.items && p.data.items.length);
  if (!pagesWithQuestions.length) throw new Error("문제가 있는 쪽이 없습니다.");

  let title = "";
  let sub = "";
  for (const p of g.pages) {
    if (!title && p.data && p.data.title) {
      title = p.data.title;
      sub = p.data.subtitle || "";
      break;
    }
  }
  if (!title) title = examName;

  const items: PackItem[] = [];
  for (const p of pagesWithQuestions) {
    for (const it of p.data.items || []) items.push({ it, pg: p.page_no });
  }

  const srcDoc = await pdfjsLib.getDocument({ data: new Uint8Array(srcBuf) }).promise;
  const pageCache = new Map<number, HTMLCanvasElement>();
  async function pageCv(n: number): Promise<HTMLCanvasElement> {
    const cached = pageCache.get(n);
    if (cached) return cached;
    const pg = await srcDoc.getPage(n);
    const v1 = pg.getViewport({ scale: 1 });
    const scale = Math.min(4, Math.max(1.5, 1500 / v1.width));
    const vp = pg.getViewport({ scale });
    const cv = document.createElement("canvas");
    cv.width = Math.ceil(vp.width);
    cv.height = Math.ceil(vp.height);
    const ctx = cv.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, cv.width, cv.height);
    await pg.render({ canvasContext: ctx, viewport: vp, intent: "print" }).promise;
    pageCache.set(n, cv);
    return cv;
  }

  let nFig = 0;
  const figErrs: string[] = [];
  for (let k = 0; k < items.length; k++) {
    const e = items[k];
    const it = e.it;
    const hang = !!(it.label && it.label.length <= 4);
    const maxW = DGL_CW - (hang ? DGL.IND : 0);
    const imgs: CroppedImg[] = [];
    e.imgs = imgs;
    for (const f of it.figures || []) {
      try {
        const pc = await pageCv(e.pg);
        const padX = Math.round(pc.width * 0.008);
        const padY = Math.round(pc.height * 0.006);
        const x0 = Math.max(0, Math.floor((f.x0 / 1000) * pc.width) - padX);
        const y0 = Math.max(0, Math.floor((f.y0 / 1000) * pc.height) - padY);
        const x1 = Math.min(pc.width, Math.ceil((f.x1 / 1000) * pc.width) + padX);
        const y1 = Math.min(pc.height, Math.ceil((f.y1 / 1000) * pc.height) + padY);
        let cv = document.createElement("canvas");
        cv.width = Math.max(2, x1 - x0);
        cv.height = Math.max(2, y1 - y0);
        (cv.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D).drawImage(
          pc,
          x0,
          y0,
          cv.width,
          cv.height,
          0,
          0,
          cv.width,
          cv.height
        );
        cv = dgTrim(cv);
        let dw = Math.max(50, Math.min(maxW, (cv.width / pc.width) * DGL.W));
        let dh = (dw * cv.height) / cv.width;
        if (dh > 360) {
          dw = (dw * 360) / dh;
          dh = 360;
        }
        imgs.push({ src: cv.toDataURL("image/jpeg", 0.92), dw, dh, w: f.where === "end" ? "end" : "stem" });
        nFig++;
      } catch (err: any) {
        figErrs.push(`${e.pg}쪽 ${it.label || ""} 그림: ${err && err.message ? err.message : err}`);
      }
    }
    tick(`그림을 오리는 중… ${k + 1}/${items.length}`);
  }
  pageCache.clear();
  try {
    await srcDoc.destroy();
  } catch {
    // ignore
  }

  try {
    await document.fonts.load("16px KaTeX_Main");
    await document.fonts.load("bold 16px KaTeX_Main");
    await document.fonts.load("16px KaTeX_Math");
    await document.fonts.ready;
  } catch {
    // ignore
  }

  injectDigitizeStyles();

  // html2canvas가 실제로 그릴 수 있으면서도 화면에는 보이지 않아야 하므로, 높이 0 + overflow
  // hidden 래퍼 안에 넣는다(visibility:hidden/display:none 대신 — 예전 시스템의 #dgStageWrap과
  // 같은 방식. html2canvas는 visibility:hidden 조상이 있으면 제대로 그리지 못하는 경우가 있다).
  const stageWrap = document.createElement("div");
  stageWrap.style.cssText = "height:0;overflow:hidden";
  document.body.appendChild(stageWrap);

  const measureEl = document.createElement("div");
  measureEl.id = "dg-measure";
  stageWrap.appendChild(measureEl);
  measureEl.innerHTML = items.map((e) => `<div class="dgw">${dgItemHtml(katex, e.it, e.imgs || [])}</div>`).join("");
  await Promise.all(
    Array.from(measureEl.querySelectorAll("img")).map((im) => {
      const image = im as HTMLImageElement;
      return image.decode ? image.decode().catch(() => undefined) : Promise.resolve();
    })
  );
  await nextTick();
  const hs = Array.from(measureEl.querySelectorAll(".dgw")).map((el) => el.getBoundingClientRect().height);

  const HEAD = 108;
  const top1 = DGL.TOP + HEAD;
  const top2 = 58;
  const capFirst = DGL.H - DGL.BOT - top1;
  const capFull = DGL.H - DGL.BOT - top2;
  const pk = dgPack(items, hs, capFirst, capFull);
  const nPg = Math.ceil(pk.cols.length / 2);
  if (!nPg) throw new Error("조판할 문항이 없습니다.");

  const stage = document.createElement("div");
  stageWrap.appendChild(stage);

  function colHtml(ci: number): string {
    return (pk.cols[ci] || [])
      .map((i) => {
        const h = dgItemHtml(katex, items[i].it, items[i].imgs || []);
        const s = pk.sc[i];
        return s
          ? `<div style="height:${Math.round(hs[i])}px;overflow:hidden"><div style="width:${Math.round(
              DGL_CW / s
            )}px;transform:scale(${s});transform-origin:0 0">${h}</div></div>`
          : `<div>${h}</div>`;
      })
      .join("");
  }

  const infoRow = '학년<i></i>반<i></i>번호<i></i>이름<i class="w"></i>';
  const pageEls: HTMLElement[] = [];
  for (let k = 0; k < nPg; k++) {
    const first = k === 0;
    const ct = first ? top1 : top2;
    const ch = DGL.H - DGL.BOT - ct;
    const html =
      `<div class="dgpg" data-pg="${k}">` +
      (first
        ? `<div class="dgt" style="top:${DGL.TOP}px"><div class="dgt1">${esc(title)}</div>${
            sub ? `<div class="dgt2">${esc(sub)}</div>` : ""
          }<div class="dgt3">${infoRow}</div></div>`
        : `<div class="dgrh">${esc(title)}</div>`) +
      `<div class="dgcols" style="top:${ct}px;height:${ch}px"><div class="dgc0">${colHtml(2 * k)}</div><div class="dgsep"></div><div class="dgc1">${colHtml(
        2 * k + 1
      )}</div></div>` +
      `<div class="dgpf">${k + 1} / ${nPg}</div></div>`;
    const wrap = document.createElement("div");
    wrap.innerHTML = html;
    const pageEl = wrap.firstElementChild as HTMLElement;
    stage.appendChild(pageEl);
    pageEls.push(pageEl);
  }
  await Promise.all(
    Array.from(stage.querySelectorAll("img")).map((im) => {
      const image = im as HTMLImageElement;
      return image.decode ? image.decode().catch(() => undefined) : Promise.resolve();
    })
  );
  await nextTick();

  const outDoc = await PDFDocument.create();
  const PW = 595.28;
  const PH = 841.89;
  const html2pdfFn = (window as any).html2pdf;
  for (let k = 0; k < nPg; k++) {
    tick(`쪽을 그리는 중… ${k + 1}/${nPg}`);
    const canvas: HTMLCanvasElement = await html2pdfFn()
      .set({
        margin: 0,
        html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff", scrollX: 0, scrollY: 0 },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      })
      .from(pageEls[k])
      .toCanvas()
      .get("canvas");
    const jpgBytes: Uint8Array = await new Promise<Uint8Array>((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (!b) {
            reject(new Error("이미지를 만들지 못했습니다."));
            return;
          }
          b.arrayBuffer().then((a) => resolve(new Uint8Array(a)), reject);
        },
        "image/jpeg",
        0.93
      );
    });
    const img = await outDoc.embedJpg(jpgBytes);
    const page = outDoc.addPage([PW, PH]);
    page.drawImage(img, { x: 0, y: 0, width: PW, height: PH });
  }

  document.body.removeChild(stageWrap);

  const bytes = await outDoc.save();
  const qItems = items.filter((e) => e.it.type === "question").length;
  return { bytes, pages: nPg, items: qItems, figs: nFig, figErrors: figErrs.length };
}

export function downloadPdfBytes(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes as any], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
