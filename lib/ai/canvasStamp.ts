import "server-only";
import { readFile } from "fs/promises";
import path from "path";
import { createCanvas, loadImage, GlobalFonts, type SKRSContext2D, type Image as CanvasImage, type Canvas } from "@napi-rs/canvas";
import QRCode from "qrcode";

// 표지·정오표·QR 안내 쪽을 "그림(PNG)"으로 그려서 PDF에 통째로 박아 넣는다.
// 기존 Apps Script(teacher-report-app.md v23~v25)의 coverCanvas/fixSheetCanvases/stampCanvas를
// 좌표 하나하나까지 그대로 옮긴 것 — 원본은 브라우저 <canvas>로 그렸지만, 서버에는 브라우저가
// 없으므로 @napi-rs/canvas(Skia 기반 Node용 캔버스)로 대신 그린다. 글자를 pdf-lib 폰트로 PDF 안에
// 직접 그리는 대신 전부 그림으로 박아 넣으므로, 한글 폰트를 PDF에 임베드/서브셋할 필요가 아예
// 없어진다 — 2026-09에 있었던 두 차례 폰트 버그(가변 폰트 gvar → CID-keyed CFF "Not a CFF Font")가
// 전부 pdf-lib의 폰트 서브셋 코드에서 난 문제였으므로, 이 방식에서는 그 버그 자체가 구조적으로
// 재발할 수 없다.

const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
const LOGO_PATH = path.join(process.cwd(), "assets", "branding", "logo.png");
const ACADEMY_TEL = "064-702-3455";
const QFONT = "Pretendard";

let fontsReady: Promise<void> | null = null;
function ensureFonts(): Promise<void> {
  if (!fontsReady) {
    fontsReady = (async () => {
      GlobalFonts.registerFromPath(path.join(FONT_DIR, "Pretendard-Regular.otf"), QFONT);
      GlobalFonts.registerFromPath(path.join(FONT_DIR, "Pretendard-Bold.otf"), QFONT);
    })();
  }
  return fontsReady;
}

let logoCache: CanvasImage | null = null;
async function loadLogo(): Promise<CanvasImage> {
  if (!logoCache) logoCache = await loadImage(await readFile(LOGO_PATH));
  return logoCache;
}

/* ── 줄바꿈(공백이 있으면 공백에서, 없으면 글자 단위로) — 원본 fixWrap 그대로 ── */
function fixWrap(g: SKRSContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  String(text)
    .split("\n")
    .forEach((para) => {
      let line = "";
      for (let i = 0; i < para.length; i++) {
        const ch = para.charAt(i);
        if (line && g.measureText(line + ch).width > maxW) {
          const sp = line.lastIndexOf(" ");
          if (sp > line.length * 0.5 && ch !== " ") {
            out.push(line.slice(0, sp));
            line = line.slice(sp + 1) + ch;
          } else {
            out.push(line);
            line = ch === " " ? "" : ch;
          }
        } else {
          line += ch;
        }
      }
      out.push(line);
    });
  return out;
}

function coverPath(g: SKRSContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.arcTo(x + w, y, x + w, y + r, r);
  g.lineTo(x + w, y + h - r);
  g.arcTo(x + w, y + h, x + w - r, y + h, r);
  g.lineTo(x + r, y + h);
  g.arcTo(x, y + h, x, y + h - r, r);
  g.lineTo(x, y + r);
  g.arcTo(x, y, x + r, y, r);
  g.closePath();
}

function coverBox(g: SKRSContext2D, x: number, y: number, w: number, h: number, r: number, fill: string | null, lw: number): void {
  coverPath(g, x, y, w, h, r);
  if (fill) {
    g.fillStyle = fill;
    g.fill();
  }
  g.lineWidth = lw;
  g.strokeStyle = "#111";
  g.stroke();
  g.fillStyle = "#111";
}

function coverSpacedW(g: SKRSContext2D, t: string, sp: number): number {
  let w = 0;
  for (let i = 0; i < t.length; i++) w += g.measureText(t.charAt(i)).width;
  return w + sp * Math.max(0, t.length - 1);
}

function coverSpaced(g: SKRSContext2D, t: string, x: number, y: number, sp: number): void {
  for (let i = 0; i < t.length; i++) {
    g.fillText(t.charAt(i), x, y);
    x += g.measureText(t.charAt(i)).width + sp;
  }
}

type Seg = [string, number]; // [글자, 굵게?]

function coverSegs(g: SKRSContext2D, segs: Seg[], x: number, y: number, size: number): void {
  for (const [text, bold] of segs) {
    g.font = (bold ? "bold " : "") + size + "px " + QFONT;
    g.fillText(text, x, y);
    x += g.measureText(text).width;
  }
}

function coverCircle(g: SKRSContext2D, x: number, y: number, r: number): void {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.lineWidth = 1.3;
  g.strokeStyle = "#111";
  g.stroke();
}

/** 표지: 시험지 맨 앞에 붙는 표지 그림(PNG). 원본 coverCanvas(name, pw, ph)와 좌표까지 동일. */
export async function renderCoverPng(name: string, pw: number, ph: number): Promise<Buffer> {
  await ensureFonts();
  const img = await loadLogo();
  const S = 2.5,
    CW0 = 816,
    M = 68,
    IW = 680,
    Hc = Math.round((CW0 * ph) / pw);
  const canvas = createCanvas(Math.round(CW0 * S), Math.round(Hc * S));
  const g = canvas.getContext("2d");
  g.scale(S, S);
  g.fillStyle = "#fff";
  g.fillRect(0, 0, CW0, Hc + 1);
  g.fillStyle = "#111";
  g.textBaseline = "middle";
  g.textAlign = "left";
  let y = 48;
  let fs = 25;
  const nm = String(name || "").replace(/\s+/g, " ").trim();
  let lines: string[] = [];
  for (;;) {
    g.font = "bold " + fs + "px " + QFONT;
    lines = fixWrap(g, nm, IW);
    if (lines.length <= 2 || fs <= 17) break;
    fs -= 1;
  }
  g.textAlign = "center";
  lines.forEach((t, k) => g.fillText(t, CW0 / 2, y + 16 + k * 32));
  y += lines.length * 32 + 30;

  g.textAlign = "left";
  g.font = "bold 58px " + QFONT;
  const title = "내신 기출 문제지";
  const tw = coverSpacedW(g, title, 3);
  g.font = "bold 25px " + QFONT;
  const bt = "내신 대비";
  const bw = g.measureText(bt).width + 44;
  const gap = 28;
  const x0 = (CW0 - (tw + gap + bw)) / 2;
  const cy = y + 42;
  g.font = "bold 58px " + QFONT;
  coverSpaced(g, title, x0, cy, 3);
  coverBox(g, x0 + tw + gap + 2, cy - 23, bw, 50, 9, "#777", 0);
  coverBox(g, x0 + tw + gap, cy - 25, bw, 50, 9, "#d9d9d9", 2);
  g.font = "bold 25px " + QFONT;
  g.textAlign = "center";
  g.fillText(bt, x0 + tw + gap + bw / 2, cy);
  g.textAlign = "left";
  y += 84 + 32;

  const fw = 380,
    cx = M + fw + 22;
  (
    [
      ["이 름", M, fw],
      ["반", cx, M + IW - cx],
    ] as [string, number, number][]
  ).forEach(([label, bx, bwid]) => {
    g.font = "20px " + QFONT;
    const lw = g.measureText(label).width + 16;
    coverBox(g, bx, y, bwid, 36, 0, null, 1.5);
    g.beginPath();
    g.moveTo(bx + lw, y);
    g.lineTo(bx + lw, y + 36);
    g.lineWidth = 1.5;
    g.stroke();
    g.fillText(label, bx + 8, y + 18);
  });
  y += 36 + 30;

  const pad = 22,
    LH = 28.35,
    tx = M + pad + 24,
    twid = IW - pad * 2 - 24;
  type Item = { s?: Seg[]; tel?: boolean; gap?: number };
  const items: Item[] = [
    { s: [["문제지 첫 장의 해당란에 반과 이름을 정확히 쓰시오.", 0]] },
    {
      s: [
        ["답은 이 시험지 ", 0],
        ["마지막 쪽의 QR", 1],
        ["을 스마트폰으로 스캔하여 제출하시오.", 0],
      ],
    },
    { s: [["제출한 답안은 자동으로 채점되고, 문항별 분석 보고서로 정리됩니다.", 0]] },
    { s: [["수학 학습 상담·문의는 아래 번호로 연락하시오.", 0]] },
    { tel: true },
    { s: [["메딕수학은 내신 기출 분석과 꼼꼼한 문항별 해설로 여러분의 성적 향상을 돕습니다.", 0]], gap: 5 },
  ];
  const top1 = y;
  let cur = y + 20;
  for (const it of items) {
    if (it.tel) {
      const telX = M + pad + 24,
        telW = 390,
        tt = "문의·상담 : " + ACADEMY_TEL;
      coverBox(g, telX, cur + 6, telW, 42, 0, "#d9d9d9", 1.5);
      g.font = "bold 24px " + QFONT;
      const w2 = coverSpacedW(g, tt, 2);
      coverSpaced(g, tt, telX + (telW - w2) / 2, cur + 6 + 21, 2);
      cur += 6 + 42 + 10;
      continue;
    }
    cur += it.gap || 0;
    let ls: Seg[][];
    if (it.s!.length === 1) {
      g.font = "16.2px " + QFONT;
      ls = fixWrap(g, it.s![0][0], twid).map((t) => [[t, 0]] as Seg[]);
    } else {
      ls = [it.s!];
    }
    ls.forEach((segs, k) => {
      const c = cur + LH / 2;
      if (!k) coverCircle(g, M + pad + 6, c, 5);
      coverSegs(g, segs, tx, c, 16.2);
      cur += LH;
    });
  }
  cur += 18;
  coverBox(g, M, top1, IW, cur - top1, 0, null, 1.5);
  y = cur + 26;

  const top2 = y,
    c2 = y + 18 + LH / 2;
  g.font = "16.2px " + QFONT;
  g.fillText("※ 메딕수학과 함께하는 내신 관리, 이렇게 도와드립니다.", M + pad, c2);
  const rows: [string, string][] = [
    ["내신 기출 분석", "학교·학기별 기출 정리"],
    ["문항별 해설", "정답과 풀이 안내"],
    ["성적 분석 보고서", "종합·개별 제공"],
  ];
  const ry = y + 18 + LH + 14;
  rows.forEach((r, k) => {
    const rc = ry + 15.3 + k * 30.6,
      lx = M + pad + 18;
    coverCircle(g, lx + 6, rc, 5);
    g.font = "17.5px " + QFONT;
    g.fillText(r[0], lx + 20, rc);
    const ne = lx + 20 + g.measureText(r[0]).width;
    g.font = "bold 15.5px " + QFONT;
    const rw = g.measureText(r[1]).width;
    g.fillText(r[1], M + IW - pad - rw, rc);
    g.beginPath();
    g.setLineDash([2, 4]);
    g.moveTo(ne + 8, rc + 8);
    g.lineTo(M + IW - pad - rw - 8, rc + 8);
    g.lineWidth = 2;
    g.strokeStyle = "#444";
    g.stroke();
    g.setLineDash([]);
  });
  cur = ry + 3 * 30.6 + 16;
  coverBox(g, M, top2, IW, cur - top2, 0, null, 1.5);
  y = cur + 26;

  coverBox(g, M, y, IW, 62, 0, "#d9d9d9", 1.5);
  g.font = "bold 19.5px " + QFONT;
  g.textAlign = "center";
  g.fillText("※ 한 문제 한 문제 차분히, 메딕수학이 여러분을 응원합니다.", CW0 / 2, y + 31);
  g.textAlign = "left";
  y += 62;

  let lw0 = 470,
    lh0 = (lw0 * img.height) / img.width;
  const minY = y + 24,
    avail = Hc - 70 - minY;
  if (avail < lh0) {
    lw0 = (lw0 * avail) / lh0;
    lh0 = avail;
  }
  if (lh0 > 8) g.drawImage(img, (CW0 - lw0) / 2, Hc - 70 - lh0, lw0, lh0);

  return canvas.encode("png");
}

/** 정오표: 정정 목록 그림(PNG) 배열(넘치면 여러 장) — 원본 fixSheetCanvases(fixes, pw, ph)와 동일. */
export async function renderFixSheetPngs(
  fixes: { label: string; issue: string; fix: string }[],
  pw: number,
  ph: number
): Promise<Buffer[]> {
  await ensureFonts();
  const W = 1240,
    H = Math.max(700, Math.round((W * ph) / pw)),
    mx = 90,
    lw = 170;
  // createCanvas는 오버로드(두 번째 인자로 "svg" 포맷도 받음) 함수라 ReturnType<typeof createCanvas>가
  // SvgCanvas로 잡혀 버그가 났었다. 실제로 여기서 만드는 건 항상 일반 PNG 캔버스이므로 Canvas로 명시.
  const sheets: Canvas[] = [];
  let g!: SKRSContext2D;
  let y = 0;

  function fresh(first: boolean) {
    const canvas = createCanvas(W, H);
    sheets.push(canvas);
    g = canvas.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, W, H);
    g.textBaseline = "alphabetic";
    g.textAlign = "left";
    g.fillStyle = "#111";
    g.font = "bold 48px " + QFONT;
    g.fillText(first ? "정오표 (시험지 정정 안내)" : "정오표 (이어서)", mx, 130);
    y = 160;
    if (first) {
      g.fillStyle = "#444";
      g.font = "27px " + QFONT;
      g.fillText("아래 문항은 시험지 인쇄에 오류가 있어 이렇게 고쳐서 풀어 주세요.", mx, 178);
      y = 210;
    }
    g.strokeStyle = "#111";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(mx, y);
    g.lineTo(W - mx, y);
    g.stroke();
    y += 16;
  }

  fresh(true);
  for (const f of fixes) {
    const txt = (f.issue ? "[오류] " + f.issue + "\n" : "") + (f.fix ? "[정정] " + f.fix : "");
    g.font = "30px " + QFONT;
    const lines = fixWrap(g, txt, W - 2 * mx - lw);
    const need = lines.length * 44 + 26;
    if (y + need > H - 90) fresh(false);
    g.fillStyle = "#111";
    g.font = "bold 34px " + QFONT;
    g.fillText(f.label ? f.label + "번" : "공통", mx, y + 40);
    g.font = "30px " + QFONT;
    lines.forEach((t, i) => g.fillText(t, mx + lw, y + 40 + i * 44));
    y += need;
    g.strokeStyle = "#bbb";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(mx, y - 6);
    g.lineTo(W - mx, y - 6);
    g.stroke();
  }

  return Promise.all(sheets.map((c) => c.encode("png")));
}

/** QR 안내 박스 그림(PNG) — 원본 stampCanvas(x)와 동일(제목·QR·안내문구·시험코드). */
export async function renderStampPng(examCode: string, submitUrl: string): Promise<Buffer> {
  await ensureFonts();
  const qrBuf = await QRCode.toBuffer(submitUrl, { type: "png", width: 560, margin: 4 });
  const qrImg = await loadImage(qrBuf);
  const s = qrImg.width;
  const W = 640,
    top = 88,
    H = top + s + 36 + 36 + 30;
  const canvas = createCanvas(W, H);
  const g = canvas.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, W, H);
  g.strokeStyle = "#111";
  g.lineWidth = 5;
  g.strokeRect(3, 3, W - 6, H - 6);
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  g.fillStyle = "#111";
  g.font = "bold 42px " + QFONT;
  g.fillText("답안 제출 QR", W / 2, 62);
  g.drawImage(qrImg, Math.round((W - s) / 2), top);
  g.font = "bold 30px " + QFONT;
  g.fillText("스캔해서 답을 제출하세요", W / 2, top + s + 34);
  g.fillStyle = "#555";
  g.font = "24px " + QFONT;
  g.fillText("시험코드 " + examCode, W / 2, top + s + 34 + 34);
  return canvas.encode("png");
}
