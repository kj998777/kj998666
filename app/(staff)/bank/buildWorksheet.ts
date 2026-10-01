// 문항 은행 → 새 시험지 PDF + 정답·해설지 PDF(2026-09-30).
//
// 시험지: 문항마다 원래 시험지 PDF에서 그 문항 자리를 오려(과외 검토 화면과 같은 cropLocator — 글자 PDF는 문항 번호 위치로,
// 스캔본은 AI 자리를 단·빈 줄에 맞춰) 2단 A4에 새 번호를 붙여 늘어놓는다. 원래 인쇄 모양(그림·표·보기)이 그대로 남는다.
// 자리를 못 찾은 문항은 AI가 옮겨 적은 문제 글(수식 포함)로 대신 넣는다.
// 정답·해설지: 성적 보고서와 같은 도구(.rpt 양식, A4 쪽 나누기)로 만든다.
import { PDFDocument } from "pdf-lib";
import { loadPdfJs } from "@/app/(staff)/exams/[code]/buildDigitizedPdf";
import { resolveRegion } from "@/app/(tutor)/tutor/review/[itemId]/cropLocator";
import { badge, ensureReportTools, esc, htmlToPdfBytes, mathHtml, MEDIC_BADGE, MEDIC_FOOT } from "@/app/(staff)/exams/[code]/results/buildReportPdf";
import type { BankDetail } from "@/lib/bank/load";

export type WsOptions = {
  title: string;
  subtitle: string;
  showSource: boolean;
  /** 한 단에 넣을 최대 문항 수(풀이 공간): 3 = 보통, 2 = 넉넉히 */
  perCol: 2 | 3;
  /** 문항 그림을 오릴 PDF 주소(기본: 직원용 원본). 과외선생님 맞춤 시험지는 그 문항이 있는 쪽 하나만 주는 주소를 쓴다 */
  pdfUrlOf?: (it: BankDetail) => string;
};

type Progress = (m: string) => void;

// A4 150dpi
const PW = 1240;
const PH = 1754;
const MX = 72;
const GAP = 48;
const CW = (PW - 2 * MX - GAP) / 2;
const TOP_FIRST = 250;
const TOP_NEXT = 110;
const BOTTOM = 90;
const FONT = "'Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic','Noto Sans CJK KR',sans-serif";
const CIRC: Record<string, string> = { "1": "①", "2": "②", "3": "③", "4": "④", "5": "⑤" };

/** 오린 가장자리에 걸친 원래 시험지의 단 구분선·머리글 줄(가장자리 가까이의 긴 세로·가로줄)을 지운다 */
function eraseEdgeLines(cv: HTMLCanvasElement): void {
  const w = cv.width;
  const h = cv.height;
  const ctx = cv.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const dark = (x: number, y: number) => {
    const p = (y * w + x) * 4;
    return d[p] * 0.3 + d[p + 1] * 0.59 + d[p + 2] * 0.11 < 200;
  };
  const edgeX = Math.max(3, Math.round(w * 0.1));
  const edgeY = Math.max(3, Math.round(h * 0.08));
  const clear = (x0: number, y0: number, x1: number, y1: number) => {
    ctx.fillStyle = "#fff";
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  };
  // 가장자리 10% 안: 높이의 절반 넘는 세로줄, 10~20%: 거의 끝까지 이어진 세로줄(단 구분선 옆 여백이 넓게 잘린 경우 — 2026-09-30)
  const edge2 = Math.max(edgeX, Math.round(w * 0.2));
  for (const xs of [
    [0, edge2],
    [w - edge2, w],
  ]) {
    for (let x = xs[0]; x < xs[1]; x++) {
      let n = 0;
      for (let y = 0; y < h; y++) if (dark(x, y)) n++;
      const inner = x >= edgeX && x < w - edgeX;
      if (n > h * (inner ? 0.85 : 0.5)) clear(Math.max(0, x - 2), 0, Math.min(w, x + 3), h);
    }
  }
  for (const ys of [
    [0, edgeY],
    [h - edgeY, h],
  ]) {
    for (let y = ys[0]; y < ys[1]; y++) {
      let n = 0;
      for (let x = 0; x < w; x++) if (dark(x, y)) n++;
      if (n > w * 0.7) clear(0, Math.max(0, y - 2), w, Math.min(h, y + 3));
    }
  }
}

function trimCanvas(cv: HTMLCanvasElement): HTMLCanvasElement {
  const w = cv.width;
  const h = cv.height;
  const ctx = cv.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
  const d = ctx.getImageData(0, 0, w, h).data;
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const p = (y * w + x) * 4;
      if (d[p] * 0.3 + d[p + 1] * 0.59 + d[p + 2] * 0.11 < 200) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return cv;
  const m = 8;
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

/**
 * 2026-09-30: 오린 문항 맨 앞의 원래 번호("12.")를 지운다(새 시험지는 위에 새 번호를 따로 쓴다).
 * 글자 정보로 찾은 번호 자리(labelBox)의 줄 높이 안에서, 왼쪽부터 잉크가 이어지는 곳(숫자·점)을 따라가다
 * 글자 사이 빈칸이 나오면 멈추고 거기까지만 흰색으로 덮는다 — 폭을 어림으로 잡으면 뒤의 글자까지 지울 수 있어서.
 */
function eraseLabel(cv: HTMLCanvasElement, box: { x0: number; y0: number; x1: number; y1: number }): boolean {
  const ctx = cv.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
  const y0 = Math.max(0, Math.floor(box.y0));
  const y1 = Math.min(cv.height, Math.ceil(box.y1));
  const bandH = y1 - y0;
  if (bandH < 4) return false;
  const xStart = Math.max(0, Math.floor(box.x0));
  const xMax = Math.min(cv.width, Math.ceil(xStart + Math.min(box.x1 - box.x0 + bandH, bandH * 4)));
  if (xMax - xStart < 3) return false;
  const d = ctx.getImageData(xStart, y0, xMax - xStart, bandH).data;
  const w = xMax - xStart;
  const colDark = (x: number) => {
    for (let y = 0; y < bandH; y++) {
      const p = (y * w + x) * 4;
      if (d[p] * 0.3 + d[p + 1] * 0.59 + d[p + 2] * 0.11 < 170) return true;
    }
    return false;
  };
  let first = -1;
  for (let x = 0; x < w; x++) if (colDark(x)) { first = x; break; }
  if (first < 0) return false;
  const gap = Math.max(3, Math.round(bandH * 0.3));
  let last = first;
  let white = 0;
  for (let x = first; x < w; x++) {
    if (colDark(x)) {
      last = x;
      white = 0;
    } else if (++white >= gap) break;
  }
  if (white < gap) return false; // 빈칸을 못 찾음 = 번호와 글이 붙어 있음 → 지우지 않는다(글을 지울 수 있어서)
  ctx.fillStyle = "#fff";
  ctx.fillRect(xStart + first - 1, y0, last - first + 3, bandH);
  return true;
}

/**
 * 글자 정보가 없는 스캔본에서 오린 문항: 맨 윗줄 왼쪽 끝의 "숫자+점"("3.", "12.")을 잉크 모양으로 찾아 지운다.
 * 틀리게 지우면 문제 글이 사라지므로 아주 좁게 본다 — 첫 줄 맨 앞 덩어리가 줄 높이의 0.3~1.7배 폭이고, 뒤에 뚜렷한 빈칸이 있고,
 * 그 덩어리의 마지막 조각이 "점"(좁고 줄 아래쪽에만 잉크)일 때만.
 */
function eraseLeadingNumberByInk(cv: HTMLCanvasElement): boolean {
  const w = cv.width;
  const h = cv.height;
  const ctx = cv.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
  const d = ctx.getImageData(0, 0, w, h).data;
  const dark = (x: number, y: number) => {
    const p = (y * w + x) * 4;
    return d[p] * 0.3 + d[p + 1] * 0.59 + d[p + 2] * 0.11 < 170;
  };
  const xLim = Math.round(w * 0.4);
  const isRule = (x: number) => {
    let n = 0;
    for (let y = 0; y < h; y += 2) if (dark(x, y)) n++;
    return n > h * 0.3; // 2칸마다 셌으므로 0.6 기준
  };
  const ruleCols = new Set<number>();
  for (let x = 0; x < Math.round(w * 0.2); x++) if (isRule(x)) ruleCols.add(x);
  const rowInk = (y: number) => {
    for (let x = 0; x < xLim; x++) if (!ruleCols.has(x) && dark(x, y)) return true;
    return false;
  };
  let top = -1;
  for (let y = 0; y < Math.min(h, Math.round(h * 0.5)); y++) if (rowInk(y)) { top = y; break; }
  if (top < 0) return false;
  let bot = top;
  let gapRows = 0;
  for (let y = top; y < h; y++) {
    if (rowInk(y)) {
      bot = y;
      gapRows = 0;
    } else if (++gapRows >= 3) break;
  }
  const H = bot - top + 1;
  if (H < 8 || H > h * 0.25) return false;
  // 세로줄(원래 시험지의 단 구분선·상자 테두리)은 번호가 아니므로 빈칸으로 본다
  const colInk = (x: number) => {
    if (ruleCols.has(x)) return false;
    for (let y = top; y <= bot; y++) if (dark(x, y)) return true;
    return false;
  };
  let x0 = -1;
  for (let x = 0; x < Math.round(w * 0.2); x++) if (colInk(x)) { x0 = x; break; } // 단 구분선 옆 여백이 넓을 수 있음
  if (x0 < 0) return false;
  // 덩어리를 조각(1px 이상 빈 세로줄로 나뉨)으로 나눠 따라가다가, 줄 높이의 0.35배 넘는 빈칸이 나오면 멈춤
  const parts: [number, number][] = [];
  let a = x0;
  let white = 0;
  let x = x0;
  for (; x < w; x++) {
    if (colInk(x)) {
      if (white > 0) {
        parts.push([a, x - white - 1]);
        a = x;
      }
      white = 0;
    } else if (++white >= Math.max(3, H * 0.35)) break;
  }
  if (white < Math.max(3, H * 0.35)) return false;
  parts.push([a, x - white]);
  const xEnd = parts[parts.length - 1][1];
  const W = xEnd - x0 + 1;
  if (W < H * 0.3 || W > H * 1.7 || parts.length < 2) return false;
  // 마지막 조각이 점인가: 좁고, 잉크가 줄 아래쪽 40% 안에만
  const [p0, p1] = parts[parts.length - 1];
  if (p1 - p0 + 1 > H * 0.3) return false;
  for (let y = top; y < top + Math.round(H * 0.6); y++) for (let xx = p0; xx <= p1; xx++) if (dark(xx, y)) return false;
  ctx.fillStyle = "#fff";
  ctx.fillRect(Math.max(0, x0 - 1), Math.max(0, top - 1), W + 2, H + 2);
  return true;
}

/** 오린 그림과, 그 그림 폭이 원래 쪽 폭에서 차지하던 비율(글자 크기를 원래와 비슷하게 맞추는 데 씀) */
export async function cropItem(lib: any, doc: any, it: BankDetail): Promise<{ cv: HTMLCanvasElement; frac: number } | null> {
  const region = await resolveRegion(lib, doc, it.label, it.sourcePage, it.bbox);
  if (!region) return null;
  const pg = await doc.getPage(region.page);
  const v1 = pg.getViewport({ scale: 1 });
  const pad = region.source === "text" ? 6 : 16;
  const b = { x0: Math.max(0, region.bbox.x0 - pad), y0: Math.max(0, region.bbox.y0 - pad), x1: Math.min(1000, region.bbox.x1 + pad), y1: Math.min(1000, region.bbox.y1 + pad) };
  const fracW = (b.x1 - b.x0) / 1000;
  const scale = Math.min(5, Math.max(1.5, (CW * 1.6) / Math.max(0.05, fracW * v1.width)));
  const vp = pg.getViewport({ scale });
  const full = document.createElement("canvas");
  full.width = Math.ceil(vp.width);
  full.height = Math.ceil(vp.height);
  const fctx = full.getContext("2d") as CanvasRenderingContext2D;
  fctx.fillStyle = "#fff";
  fctx.fillRect(0, 0, full.width, full.height);
  await pg.render({ canvasContext: fctx, viewport: vp, intent: "print" }).promise;
  const cx = Math.round((b.x0 / 1000) * full.width);
  const cy = Math.round((b.y0 / 1000) * full.height);
  const cw = Math.max(2, Math.round(fracW * full.width));
  const ch = Math.max(2, Math.round(((b.y1 - b.y0) / 1000) * full.height));
  const cv = document.createElement("canvas");
  cv.width = cw;
  cv.height = ch;
  const ctx = cv.getContext("2d") as CanvasRenderingContext2D;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(full, cx, cy, cw, ch, 0, 0, cw, ch);
  eraseEdgeLines(cv); // 단 구분선을 먼저 지워야 스캔본 번호 찾기가 선을 번호로 잘못 보지 않는다
  if (!region.labelBox) {
    eraseLeadingNumberByInk(cv); // 스캔본(글자 정보 없음)
  } else {
    const lb = region.labelBox;
    eraseLabel(cv, {
      x0: (lb.x0 / 1000) * full.width - cx,
      y0: (lb.y0 / 1000) * full.height - cy,
      x1: (lb.x1 / 1000) * full.width - cx,
      y1: (lb.y1 / 1000) * full.height - cy,
    });
  }
  const t = trimCanvas(cv);
  return { cv: t, frac: t.width / full.width };
}

/** 자리를 못 찾은 문항: 문제 글(수식)을 그림으로 */
async function textItem(katex: any, it: BankDetail): Promise<HTMLCanvasElement> {
  const h2c = (window as any).html2canvas;
  const el = document.createElement("div");
  el.style.cssText = `position:absolute;left:-100000px;top:0;width:${Math.round(CW / 1.6)}px;background:#fff;color:#111827;font-family:${FONT};font-size:14px;line-height:1.8;padding:4px`;
  if (it.dg && it.dg.stem) {
    // 2026-09-30: 디지털화한 시험이면 옮겨 적은 문제(<보기>·선택지까지)를 디지털 시험지와 같은 모양으로 — 문제 요약보다 원래 문제에 가깝다.
    // 그림은 자리만 표시(원래 시험지에서 오릴 자리를 못 찾은 문항이라).
    const { renderDgItemPreview } = await import("@/app/(staff)/exams/[code]/buildDigitizedPdf");
    const figs = Array.from({ length: Math.min(3, it.dg.figures) }, () => ({ x0: 0, y0: 0, x1: 1, y1: 1, where: "stem" as const }));
    el.innerHTML = await renderDgItemPreview({ type: "question", label: "", stem: it.dg.stem, box_title: it.dg.box_title, box_lines: it.dg.box_lines, choices: it.dg.choices, figures: figs });
  } else {
    el.innerHTML = mathHtml(katex, it.statement || "(문제 글이 없습니다 — 원래 시험지에서 확인해 주세요)");
  }
  document.body.appendChild(el);
  try {
    return await h2c(el, { scale: 1.6, backgroundColor: "#ffffff", logging: false });
  } finally {
    document.body.removeChild(el);
  }
}

function sourceText(it: BankDetail): string {
  return `${it.examName.replace(/_/g, " ").replace(/\s+/g, " ").trim()} ${it.label}번`;
}

type Block = { it: BankDetail; img: HTMLCanvasElement; w: number; h: number; text: boolean };
const HEAD_H = 40; // 새 번호·출처 줄

export async function buildWorksheetPdf(
  items: BankDetail[],
  opts: WsOptions,
  onProgress?: Progress
): Promise<{ bytes: Uint8Array; pages: number; textFallback: string[] }> {
  const tick = (m: string) => onProgress && onProgress(m);
  tick("도구를 불러오는 중…");
  const [{ katex }, lib] = await Promise.all([ensureReportTools(), loadPdfJs()]);

  const docs = new Map<string, Promise<any>>();
  const urlOf = (it: BankDetail) => (opts.pdfUrlOf ? opts.pdfUrlOf(it) : `/exams/${encodeURIComponent(it.examCode)}/original-pdf`);
  const docOf = (url: string) => {
    if (!docs.has(url)) {
      docs.set(
        url,
        (async () => {
          const r = await fetch(url, { credentials: "same-origin", cache: "no-store" });
          if (!r.ok) throw new Error("원본 PDF를 불러오지 못했습니다.");
          return lib.getDocument({ data: new Uint8Array(await r.arrayBuffer()) }).promise;
        })()
      );
    }
    return docs.get(url)!;
  };

  const blocks: Block[] = [];
  const textFallback: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    tick(`문항을 오리는 중… ${i + 1}/${items.length}`);
    let img: HTMLCanvasElement | null = null;
    let w = CW;
    try {
      const c = await cropItem(lib, await docOf(urlOf(it)), it);
      if (c) {
        img = c.cv;
        // 원래 시험지에서의 크기 그대로(원래 쪽 본문 폭 ≈ 이 시험지 본문 폭) — 단보다 넓으면 단에 맞춰 줄임.
        // 전에는 모두 단 폭으로 늘려서 짧은 문항은 글자가 커지고 긴 문항은 작아져 들쭉날쭉했다.
        w = Math.min(CW, Math.max(CW * 0.35, c.frac * (PW - 2 * MX) * 1.05));
      }
    } catch {
      img = null;
    }
    let text = false;
    if (!img) {
      img = await textItem(katex, it);
      text = true;
      textFallback.push(sourceText(it));
      w = Math.min(CW, img.width / 1.6 * 1.6);
    }
    let h = (img.height * w) / img.width;
    const maxH = PH - TOP_NEXT - BOTTOM - HEAD_H - 20;
    if (h > maxH) {
      w = (w * maxH) / h;
      h = maxH;
    }
    blocks.push({ it, img, w, h, text });
  }
  for (const d of docs.values()) {
    try {
      (await d).destroy();
    } catch {
      /* 무시 */
    }
  }

  // 단 채우기: 한 단에 opts.perCol개까지, 넘치면 다음 단
  const cap = (ci: number) => PH - BOTTOM - (ci < 2 ? TOP_FIRST : TOP_NEXT);
  const cols: number[][] = [];
  let cur: number[] = [];
  let curH = 0;
  blocks.forEach((b, i) => {
    const bh = HEAD_H + b.h;
    if (cur.length && (cur.length >= opts.perCol || curH + bh > cap(cols.length))) {
      cols.push(cur);
      cur = [];
      curH = 0;
    }
    cur.push(i);
    curH += bh;
  });
  if (cur.length) cols.push(cur);
  const nPg = Math.max(1, Math.ceil(cols.length / 2));

  const out = await PDFDocument.create();
  for (let k = 0; k < nPg; k++) {
    tick(`쪽을 그리는 중… ${k + 1}/${nPg}`);
    const cv = document.createElement("canvas");
    cv.width = PW;
    cv.height = PH;
    const ctx = cv.getContext("2d") as CanvasRenderingContext2D;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, PW, PH);
    ctx.fillStyle = "#111827";
    ctx.textBaseline = "alphabetic";
    const first = k === 0;
    if (first) {
      ctx.textAlign = "center";
      ctx.font = `bold 40px ${FONT}`;
      ctx.fillText(opts.title || "메딕수학 복습 시험지", PW / 2, 110);
      if (opts.subtitle) {
        ctx.font = `24px ${FONT}`;
        ctx.fillStyle = "#374151";
        ctx.fillText(opts.subtitle, PW / 2, 150);
      }
      ctx.fillStyle = "#111827";
      ctx.fillRect(MX, 180, PW - 2 * MX, 3);
      ctx.fillStyle = "#6b7280";
      ctx.fillRect(MX, 222, PW - 2 * MX, 1.5);
      ctx.textAlign = "right";
      ctx.font = `20px ${FONT}`;
      ctx.fillStyle = "#4b5563";
      ctx.fillText(`${items.length}문항 · 이름 ____________`, PW - MX, 210);
      ctx.textAlign = "left";
      ctx.fillText("메딕수학", MX, 210);
    } else {
      ctx.textAlign = "left";
      ctx.font = `18px ${FONT}`;
      ctx.fillStyle = "#6b7280";
      ctx.fillText(opts.title || "메딕수학 복습 시험지", MX, 70);
      ctx.fillStyle = "#d1d5db";
      ctx.fillRect(MX, 82, PW - 2 * MX, 1.5);
    }
    const top = first ? TOP_FIRST : TOP_NEXT;
    // 가운데 세로줄
    ctx.fillStyle = "#9ca3af";
    ctx.fillRect(PW / 2 - 0.75, top, 1.5, PH - BOTTOM - top);
    for (let side = 0; side < 2; side++) {
      const ci = 2 * k + side;
      const col = cols[ci] || [];
      if (!col.length) continue;
      const x = MX + side * (CW + GAP);
      const c = cap(ci);
      const hs = col.map((i) => HEAD_H + blocks[i].h);
      const slot = Math.floor(c / col.length);
      const even = hs.every((h) => h <= slot);
      const extra = even ? 0 : Math.max(0, Math.floor((c - hs.reduce((a, b) => a + b, 0)) / col.length));
      let y = top;
      col.forEach((i, j) => {
        const b = blocks[i];
        const n = i + 1;
        ctx.textAlign = "left";
        ctx.fillStyle = "#111827";
        ctx.font = `bold 28px ${FONT}`;
        ctx.fillText(`${n}.`, x, y + 28);
        if (opts.showSource) {
          ctx.font = `17px ${FONT}`;
          ctx.fillStyle = "#6b7280";
          const src = `${sourceText(b.it)}${b.it.unit ? " · " + b.it.unit : ""}`;
          let s = src;
          while (s.length > 4 && ctx.measureText(s).width > CW - 60) s = s.slice(0, -2);
          ctx.fillText(s === src ? s : s + "…", x + 52, y + 27);
        }
        ctx.drawImage(b.img, x, y + HEAD_H, b.w, b.h);
        y += even ? slot : hs[j] + extra;
      });
    }
    ctx.textAlign = "center";
    ctx.font = `18px ${FONT}`;
    ctx.fillStyle = "#6b7280";
    ctx.fillText(`${k + 1} / ${nPg}`, PW / 2, PH - 40);
    const blob: Blob = await new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("쪽 그림을 만들지 못했습니다."))), "image/jpeg", 0.92));
    const jpg = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    const page = out.addPage([595.28, 841.89]);
    page.drawImage(jpg, { x: 0, y: 0, width: 595.28, height: 841.89 });
  }
  return { bytes: await out.save(), pages: nPg, textFallback };
}

function keyText(katex: any, it: BankDetail): string {
  if (it.answerDisplay && it.answerDisplay.trim()) return mathHtml(katex, it.answerDisplay);
  const raw = String(it.correctAnswers ?? "").trim();
  if (!raw) return "-";
  const alts = raw.split("|").map((x) => x.trim()).filter(Boolean);
  if (it.type === "객관식") return esc(alts.map((x) => (/^[1-5]+$/.test(x) ? x.split("").map((c) => CIRC[c]).join("") : x)).join(" 또는 "));
  return alts.map((x) => mathHtml(katex, x)).join(" 또는 ");
}

export async function buildAnswerPdf(items: BankDetail[], opts: WsOptions, onProgress?: Progress): Promise<Uint8Array> {
  const { katex } = await ensureReportTools(onProgress);
  onProgress && onProgress("정답·해설지를 만드는 중…");
  const b: string[] = [];
  b.push(
    `<div class="rpt-rowh"><div><h1>정답과 해설</h1><div class="rpt-sub" style="margin:0">${esc(opts.title || "메딕수학 복습 시험지")} · ${items.length}문항</div></div>${MEDIC_BADGE}</div>`
  );
  b.push("<h2>빠른 정답</h2>");
  const half = Math.ceil(items.length / 2);
  b.push('<div style="display:flex;gap:10px">');
  for (const [base, part] of [
    [0, items.slice(0, half)],
    [half, items.slice(half)],
  ] as [number, BankDetail[]][]) {
    if (!part.length) continue;
    b.push('<table style="flex:1"><thead><tr><th style="width:14%">번호</th><th>정답</th><th style="width:20%">난이도</th></tr></thead><tbody>');
    part.forEach((it, j) => {
      b.push(`<tr><td class="c"><b>${base + j + 1}</b></td><td class="c">${keyText(katex, it)}</td><td class="c">${badge(it.difficulty)}</td></tr>`);
    });
    b.push("</tbody></table>");
  }
  b.push("</div>");
  b.push('<h2 class="rpt-pagebreak">문항별 해설</h2>');
  items.forEach((it, i) => {
    b.push(
      `<div class="rpt-card"><div class="hd">${i + 1}번 · ${esc(it.unit || it.area || "단원 미상")} · ${badge(it.difficulty)}${
        opts.showSource ? ` <span class="rpt-small">(${esc(sourceText(it))})</span>` : ""
      }</div><div class="row"><span class="rpt-pill key">정답: <b>${keyText(katex, it)}</b></span></div>${
        it.solution ? `<div class="rpt-sol"><b>풀이</b> — ${mathHtml(katex, it.solution)}</div>` : '<div class="rpt-small">풀이가 아직 없습니다.</div>'
      }</div>`
    );
  });
  b.push('<p class="rpt-foot">난이도는 AI가 문제를 풀어 보고 붙인 값입니다.</p>');
  b.push(MEDIC_FOOT);
  return htmlToPdfBytes(`<div class="rpt">${b.join("")}</div>`);
}
