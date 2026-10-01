// 과외선생님 검토 화면의 "문항만 잘라 보기" 영역을 브라우저에서 바로잡는다(2026-09-29 원장님 제보: 엉뚱한 곳이 잘림 /
// 다른 번호 문제가 나옴 / 쪽 전체가 나옴).
//
// AI가 적어 둔 쪽 번호·영역(item_explanations.source_page + bbox_*)은 대략적인 값이라 틀리는 일이 잦았다. 그래서
//  1) 글자 정보가 있는 PDF(한글·워드에서 저장한 시험지 등)는 PDF 안의 글자 위치에서 문항 번호("3.", "[서답형 1]")를 직접
//     찾아, 그 번호부터 같은 단의 다음 번호 바로 위까지를 자른다 — AI 좌표보다 우선. 번호가 1, 2, 3… 순서로 이어지는
//     것만 인정해서(보기 안의 "3." 같은 것에 속지 않도록) 엉뚱한 번호를 고르지 않게 한다.
//  2) 글자 정보가 없는 PDF(스캔본·디지털 조판본)는 AI 영역을 쓰되, 그림을 그려 보고 단(칼럼) 경계와 빈 줄에 맞춰
//     넓혀서 문제가 반쯤 잘리지 않게 한다. 넓힌 영역이 거의 빈 곳이면(엉뚱한 곳) 쓰지 않고 쪽 전체를 보여 준다.
// 모든 좌표는 그 쪽을 가로·세로 1000칸으로 본 값(DB와 같은 규칙).

export type Box = { x0: number; y0: number; x1: number; y1: number };
// labelBox(2026-09-30): 글자 정보로 찾은 문항 번호("12.")가 인쇄된 자리 — 문항 은행 시험지에서 원래 번호를 지우고 새 번호를 쓰는 데 씀
export type Region = { page: number; bbox: Box; source: "text" | "ai"; labelBox?: Box };

type Anchor = { page: number; col: number; top: number; x: number; off: number; kind: "main" | "sa"; n: number; w: number; h: number };
type PageText = { cols: { x0: number; x1: number }[]; bottoms: number[]; anchors: Anchor[]; hasText: boolean };

// ---------------------------------------------------------------------
// 문항 번호(label) 해석: "12" → main 12, "서답형3"/"서술형3"/"서3" → sa 3, "27-(1)" → main 27
// ---------------------------------------------------------------------
export function parseLabel(label: string): { kind: "main" | "sa"; n: number } | null {
  const s = String(label || "").replace(/\s+/g, "").replace(/-\(.*$/, "").replace(/번$/, "");
  let m = /^(?:서답형|서술형|단답형|논술형|주관식|서답|서술|단답|논술|서)(\d{1,2})$/.exec(s);
  if (m) return { kind: "sa", n: Number(m[1]) };
  m = /^0?(\d{1,2})$/.exec(s);
  if (m) return { kind: "main", n: Number(m[1]) };
  return null;
}

const MAIN_RE = /^\s*0?(\d{1,2})\s*[.．](?!\d)/;
const SA_RE = /^\s*[\[【(<〈]?\s*(?:서답형|서술형|단답형|논술형|주관식)\s*0?(\d{1,2})(?!\d)/;

// ---------------------------------------------------------------------
// 1) 글자 정보에서 문항 번호 위치 찾기
// ---------------------------------------------------------------------
export async function readPageText(pdfjsLib: any, pg: any, pageNo: number): Promise<PageText> {
  const vp = pg.getViewport({ scale: 1 });
  const tc = await pg.getTextContent();
  type T = { s: string; x: number; x1: number; top: number; bot: number; base: number; h: number };
  const raw: T[] = [];
  for (const it of tc.items as any[]) {
    const str = String(it.str ?? "");
    if (!str.trim()) continue;
    const t = pdfjsLib.Util.transform(vp.transform, it.transform);
    const h = Math.hypot(t[2], t[3]) || Number(it.height) || 10;
    const x = (t[4] / vp.width) * 1000;
    const w = ((Number(it.width) || 0) / vp.width) * 1000;
    const base = (t[5] / vp.height) * 1000;
    const hn = (h / vp.height) * 1000;
    raw.push({ s: str, x, x1: x + Math.max(w, 1), top: base - hn, bot: base + hn * 0.25, base, h: hn });
  }
  if (raw.length < 15) return { cols: [{ x0: 0, x1: 1000 }], bottoms: [1000], anchors: [], hasText: false };

  // 글자 조각을 줄 조각(segment)으로 묶는다 — PDF에 따라 글자 하나하나가 따로 적혀 있기도 하다.
  raw.sort((a, b) => a.base - b.base);
  const lines: T[][] = [];
  for (const r of raw) {
    const ln = lines[lines.length - 1];
    if (ln && Math.abs(r.base - ln[0].base) < Math.max(r.h, ln[0].h) * 0.4) ln.push(r);
    else lines.push([r]);
  }
  const ts: T[] = [];
  for (const ln of lines) {
    ln.sort((a, b) => a.x - b.x);
    let cur: T | null = null;
    for (const r of ln) {
      if (cur && r.x - cur.x1 < Math.max(r.h, cur.h) * 1.5) {
        cur.s += (r.x - cur.x1 > cur.h * 0.3 ? " " : "") + r.s;
        cur.x1 = Math.max(cur.x1, r.x1);
        cur.top = Math.min(cur.top, r.top);
        cur.bot = Math.max(cur.bot, r.bot);
      } else {
        cur = { ...r };
        ts.push(cur);
      }
    }
  }

  // 단 나누기: 가운데(480~520)를 가로지르는 긴 줄이 거의 없고 양쪽에 글이 있으면 2단
  const long = ts.filter((t) => t.x1 - t.x > 40);
  const crossing = long.filter((t) => t.x < 480 && t.x1 > 520).length;
  const left = ts.filter((t) => t.x1 <= 510).length;
  const right = ts.filter((t) => t.x >= 490).length;
  // 제목·쪽 번호 한두 줄은 가운데를 가로질러도 2단으로 본다
  const twoCol = long.length > 0 && (crossing <= 2 || crossing / long.length < 0.06) && left >= 3 && right >= 3;
  const colOf = (x: number) => (twoCol && x >= 495 ? 1 : 0);
  // 제목·쪽 번호처럼 가운데를 가로지르는 글줄과 맨 아래 머리글 영역은 단 크기 계산에서 뺀다
  const body = ts.filter((t) => !(twoCol && t.x < 480 && t.x1 > 520) && t.top < 940);
  const L = body.filter((t) => colOf(t.x) === 0);
  const Rr = body.filter((t) => colOf(t.x) === 1);
  const ext = (arr: T[], cap?: number) =>
    arr.length
      ? { x0: Math.min(...arr.map((t) => t.x)), x1: Math.min(cap ?? 1000, Math.max(...arr.map((t) => t.x1))) }
      : { x0: 0, x1: cap ?? 1000 };
  const cols = twoCol ? [ext(L, 492), ext(Rr)] : [ext(body.length ? body : ts)];
  const bottoms = cols.map((_c, ci) => Math.max(...body.filter((t) => colOf(t.x) === ci).map((t) => t.bot), 0));

  const anchors: Anchor[] = [];
  for (const t of body) {
    const ci = colOf(t.x);
    const off = t.x - cols[ci].x0;
    if (off > 60) continue; // 줄 맨 앞(그 단의 왼쪽 끝 근처)에 있는 번호만
    // 번호 부분의 폭: 줄 조각 폭을 글자 수 비율로 나눈 어림값
    const wOf = (len: number) => ((t.x1 - t.x) * Math.min(len, t.s.length)) / Math.max(1, t.s.length);
    let m = SA_RE.exec(t.s);
    if (m) {
      anchors.push({ page: pageNo, col: ci, top: t.top, x: t.x, off, kind: "sa", n: Number(m[1]), w: wOf(m[0].length), h: t.bot - t.top });
      continue;
    }
    m = MAIN_RE.exec(t.s);
    if (m) anchors.push({ page: pageNo, col: ci, top: t.top, x: t.x, off, kind: "main", n: Number(m[1]), w: wOf(m[0].length), h: t.bot - t.top });
  }
  return { cols, bottoms, anchors, hasText: true };
}

/** 읽는 순서(쪽 → 단 → 위아래)로 1, 2, 3…처럼 하나씩 늘어나는 가장 긴 사슬만 남긴다. */
function longestChain(list: Anchor[]): Anchor[] {
  const best: { len: number; prev: number }[] = [];
  const lastIdxOfN = new Map<number, number>(); // n → 그 번호로 끝나는 가장 긴 사슬의 마지막 위치
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const p = lastIdxOfN.get(a.n - 1);
    const len = p !== undefined ? best[p].len + 1 : 1;
    best.push({ len, prev: p !== undefined ? p : -1 });
    const cur = lastIdxOfN.get(a.n);
    // 길이가 같으면 단 왼쪽 끝에 더 붙어 있는 것(진짜 문항 번호는 보통 들여쓰기가 없음)을 고른다
    if (cur === undefined || best[cur].len < len || (best[cur].len === len && a.off + 3 < list[cur].off)) lastIdxOfN.set(a.n, i);
  }
  let end = -1;
  for (let i = 0; i < best.length; i++) if (end < 0 || best[i].len > best[end].len) end = i;
  const out: Anchor[] = [];
  for (let i = end; i >= 0; i = best[i].prev) out.unshift(list[i]);
  return out;
}

const textCache = new WeakMap<object, Promise<{ pages: PageText[]; main: Anchor[]; sa: Anchor[] }>>();

async function docText(pdfjsLib: any, doc: any) {
  let p = textCache.get(doc);
  if (!p) {
    p = (async () => {
      const pages: PageText[] = [];
      for (let i = 1; i <= Math.min(doc.numPages, 40); i++) {
        try {
          pages.push(await readPageText(pdfjsLib, await doc.getPage(i), i));
        } catch {
          pages.push({ cols: [{ x0: 0, x1: 1000 }], bottoms: [1000], anchors: [], hasText: false });
        }
      }
      const all = pages.flatMap((pt) => pt.anchors).sort((a, b) => a.page - b.page || a.col - b.col || a.top - b.top);
      return {
        pages,
        main: longestChain(all.filter((a) => a.kind === "main")),
        sa: longestChain(all.filter((a) => a.kind === "sa")),
      };
    })();
    textCache.set(doc, p);
  }
  return p;
}

async function regionFromText(pdfjsLib: any, doc: any, label: string): Promise<(Region & { open: boolean }) | null> {
  const want = parseLabel(label);
  if (!want) return null;
  const t = await docText(pdfjsLib, doc);
  // 번호 사슬이 짧으면 글자 정보만으로는 믿지 않음. 2026-10-01: 문항이 있는 쪽 하나만 받은 PDF(맞춤 시험지·입학테스트·
  // 휴대폰 검토 화면)는 한 쪽에 번호가 2~3개뿐인 경우가 많아 2개부터 믿는다(전에는 이 경우 자리를 못 찾고 글로 대신했다).
  if (t.main.length < (doc.numPages === 1 ? 2 : 3)) return null;
  const chain = want.kind === "main" ? t.main : t.sa;
  const a = chain.find((c) => c.n === want.n);
  if (!a) return null;
  const pt = t.pages[a.page - 1];
  const col = pt.cols[a.col] ?? { x0: 0, x1: 1000 };
  // 같은 쪽·같은 단에서 바로 아래에 있는 다음 번호(본문·서답형 어느 쪽이든) 바로 위까지
  const below = [...t.main, ...t.sa].filter((c) => c.page === a.page && c.col === a.col && c.top > a.top + 5);
  const nextTop = below.length ? Math.min(...below.map((c) => c.top)) : null;
  const y0 = Math.max(0, a.top - 12);
  const y1 = nextTop !== null ? Math.max(y0 + 20, nextTop - 6) : Math.min(1000, Math.max(pt.bottoms[a.col] ?? 980, y0 + 40) + 15);
  // 가로 범위: 글줄 끝이 아니라 단 전체(그림이 글보다 넓을 수 있음). 2단이면 왼쪽 단은 오른쪽 단 시작 바로 앞까지,
  // 오른쪽 단은 왼쪽 여백과 같은 만큼 남긴 오른쪽 끝까지.
  let xa = col.x0 - 12;
  let xb = col.x1 + 12;
  if (pt.cols.length === 2) {
    if (a.col === 0) xb = Math.max(xb, Math.min(pt.cols[1].x0 - 15, 495)); // 가운데 구분선은 빼고
    else xb = Math.max(xb, 1000 - pt.cols[0].x0 + 12);
  }
  return {
    page: a.page,
    bbox: { x0: Math.max(0, xa), y0, x1: Math.min(1000, xb), y1 },
    source: "text",
    labelBox: { x0: Math.max(0, a.x - 2), y0: Math.max(0, a.top - 2), x1: Math.min(1000, a.x + a.w + 2), y1: Math.min(1000, a.top + a.h + 2) },
    open: nextTop === null, // 그 단의 마지막 문항(아래 끝을 글자로는 확실히 모름)
  };
}

// ---------------------------------------------------------------------
// 2) 그림(잉크)으로 AI 영역 넓히기·검사
// ---------------------------------------------------------------------
type Ink = { w: number; h: number; on: Uint8Array; rule: Uint8Array };

async function inkOf(pg: any): Promise<Ink> {
  const v1 = pg.getViewport({ scale: 1 });
  const scale = 900 / v1.width;
  const vp = pg.getViewport({ scale });
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(vp.width));
  cv.height = Math.max(1, Math.round(vp.height));
  const ctx = cv.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, cv.width, cv.height);
  await pg.render({ canvasContext: ctx, viewport: vp }).promise;
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const on = new Uint8Array(cv.width * cv.height);
  for (let i = 0, j = 0; j < on.length; i += 4, j++) {
    on[j] = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11 < 205 ? 1 : 0; // 연한 테두리(상자·표 선)도 잉크로
  }
  // 쪽 위아래로 길게 이어진 세로줄(단 사이 구분선 등)은 "빈 줄" 판단에서 뺀다(표·그림 테두리는 짧아서 해당 없음)
  const w = cv.width, h = cv.height;
  const rule = new Uint8Array(w);
  const ya = Math.round(h * 0.1), yb = Math.round(h * 0.93);
  for (let x = 0; x < w; x++) {
    let c = 0;
    for (let y = ya; y < yb; y++) c += on[y * w + x];
    rule[x] = c / Math.max(1, yb - ya) > 0.5 ? 1 : 0;
  }
  return { w, h, on, rule };
}

function colSplit(ink: Ink): number | null {
  const { w, h, on } = ink;
  const ya = Math.round(h * 0.1);
  const yb = Math.round(h * 0.93);
  const colInk = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    let c = 0;
    for (let y = ya; y < yb; y++) c += on[y * w + x];
    colInk[x] = c / Math.max(1, yb - ya);
  }
  const blank = (x: number) => colInk[x] < 0.012 || (colInk[x] > 0.55 && (colInk[x - 3] ?? 0) < 0.03 && (colInk[x + 3] ?? 0) < 0.03);
  let best: [number, number] | null = null;
  let run = -1;
  for (let x = Math.round(w * 0.35); x <= Math.round(w * 0.65); x++) {
    if (blank(x)) {
      if (run < 0) run = x;
    } else if (run >= 0) {
      if (!best || x - run > best[1] - best[0]) best = [run, x];
      run = -1;
    }
  }
  if (run >= 0) {
    const x = Math.round(w * 0.65);
    if (!best || x - run > best[1] - best[0]) best = [run, x];
  }
  if (!best || best[1] - best[0] < w * 0.008) return null;
  // 양쪽 모두 글이 충분히 있어야 2단으로 본다
  const side = (a: number, b: number) => {
    let c = 0;
    for (let x = a; x < b; x++) c += colInk[x];
    return c / Math.max(1, b - a);
  };
  if (side(Math.round(w * 0.08), best[0]) < 0.002 || side(best[1], Math.round(w * 0.92)) < 0.002) return null;
  return (((best[0] + best[1]) / 2) / w) * 1000;
}

function rowBlank(ink: Ink, xa: number, xb: number): (y: number) => boolean {
  const { w, on, rule } = ink;
  const a = Math.max(0, Math.round((xa / 1000) * w));
  const b = Math.min(w, Math.round((xb / 1000) * w));
  return (y: number) => {
    let c = 0;
    const row = y * w;
    for (let x = a; x < b; x++) if (!rule[x]) c += on[row + x];
    return c <= 1;
  };
}

function inkRatio(ink: Ink, box: Box): number {
  const { w, h, on, rule } = ink;
  const xa = Math.round((box.x0 / 1000) * w), xb = Math.round((box.x1 / 1000) * w);
  const ya = Math.round((box.y0 / 1000) * h), yb = Math.round((box.y1 / 1000) * h);
  let c = 0;
  for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) if (!rule[x]) c += on[y * w + x];
  return c / Math.max(1, (xb - xa) * (yb - ya));
}

/** AI 영역을 단 경계·빈 줄에 맞춰 넓힌다(줄이지는 않음). 쓸 만하지 않으면 null. */
function snapToInk(ink: Ink, b: Box, split: number | null): Box | null {
  let x0 = b.x0, x1 = b.x1;
  if (split !== null && b.x1 - b.x0 < 650) {
    const cx = (b.x0 + b.x1) / 2;
    if (cx < split) {
      x0 = Math.min(b.x0, 30);
      x1 = split - 5;
    } else {
      x0 = split + 5;
      x1 = Math.max(b.x1, 970);
    }
  }
  // 단을 모르면(1단이거나 판단 실패) 가로로도 잉크가 이어지는 데까지 넓힌다(번호가 왼쪽에서 잘리지 않게)
  if (split === null || b.x1 - b.x0 >= 650) {
    const yA = Math.round((b.y0 / 1000) * ink.h), yB = Math.round((b.y1 / 1000) * ink.h);
    const colBlank = (xp: number) => {
      let c = 0;
      for (let y = yA; y < yB; y++) c += ink.on[y * ink.w + xp];
      return ink.rule[xp] === 1 || c <= 1;
    };
    const gx = Math.max(4, Math.round(ink.w * 0.03));
    let xl = Math.round((x0 / 1000) * ink.w);
    for (let xp = xl, run = 0; xp >= 0; xp--) {
      run = colBlank(xp) ? run + 1 : 0;
      if (run >= gx || xp === 0) {
        xl = xp + run;
        break;
      }
    }
    let xr = Math.round((x1 / 1000) * ink.w);
    for (let xp = xr, run = 0; xp < ink.w; xp++) {
      run = colBlank(xp) ? run + 1 : 0;
      if (run >= gx || xp === ink.w - 1) {
        xr = xp - run + 1;
        break;
      }
    }
    x0 = Math.min(x0, (xl / ink.w) * 1000 - 5);
    x1 = Math.max(x1, (xr / ink.w) * 1000 + 5);
  }
  const isBlank = rowBlank(ink, x0, x1);
  const H = ink.h;
  // 문항 사이 틈(보통 두 줄 이상 비움)만 경계로 본다. 그림과 선택지 사이 같은 좁은 틈에서 멈추지 않도록 넉넉히.
  const gapMin = Math.max(4, Math.round(H * 0.018));
  const py = (v: number) => Math.max(0, Math.min(H - 1, Math.round((v / 1000) * H)));
  // 위쪽: y0에서 위로 올라가며 빈 줄이 gapMin만큼 이어지는 곳(문단 사이 틈)을 찾아 그 아래부터
  let y0p = py(b.y0);
  for (let y = y0p, run = 0, lim = Math.max(0, y0p - Math.round(H * 0.16)); y >= lim; y--) {
    run = isBlank(y) ? run + 1 : 0;
    if (run >= gapMin) {
      y0p = y + run;
      break;
    }
  } // 틈을 못 찾으면 원래 위치 그대로
  // 아래쪽: y1에서 아래로 내려가며 틈을 찾아 거기까지
  let y1p = py(b.y1);
  for (let y = y1p, run = 0, lim = Math.min(H - 1, y1p + Math.round(H * 0.16)); y <= lim; y++) {
    run = isBlank(y) ? run + 1 : 0;
    if (run >= gapMin) {
      y1p = y - run + 1;
      break;
    }
  } // 틈을 못 찾으면 원래 위치 그대로
  const out: Box = {
    x0: Math.max(0, x0),
    y0: Math.max(0, (y0p / H) * 1000 - 8),
    x1: Math.min(1000, x1),
    y1: Math.min(1000, (y1p / H) * 1000 + 8),
  };
  if (out.x1 - out.x0 < 30 || out.y1 - out.y0 < 20) return null;
  if (inkRatio(ink, out) < 0.004) return null; // 거의 빈 곳 = 엉뚱한 곳
  if (out.x1 - out.x0 > 950 && out.y1 - out.y0 > 950) return null; // 쪽 전체나 다름없음
  return out;
}

/** 단의 마지막 문항: 글줄 아래로 그림·선택지가 더 있으면 그 끝까지(큰 빈칸이 나오거나 쪽 아래 머리글 영역 전까지). */
function extendDown(ink: Ink, box: Box): number {
  const isBlank = rowBlank(ink, box.x0, box.x1);
  const H = ink.h;
  const start = Math.round((box.y1 / 1000) * H);
  const stop = Math.round(H * 0.94);
  const bigGap = Math.round(H * 0.06);
  let last = start;
  for (let y = start, run = 0; y < stop; y++) {
    if (isBlank(y)) {
      run++;
      if (run >= bigGap) break;
    } else {
      run = 0;
      last = y;
    }
  }
  return Math.min(1000, (last / H) * 1000 + 10);
}

// ---------------------------------------------------------------------
// 합치기
// ---------------------------------------------------------------------

/**
 * 이 문항을 어디서 잘라 보여 줄지 정한다. 글자 정보에서 번호를 찾으면 그것, 아니면 AI 영역을 그림에 맞춰 넓힌 것,
 * 둘 다 안 되면 null(= 쪽 전체 보기).
 */
export async function resolveRegion(
  pdfjsLib: any,
  doc: any,
  label: string,
  aiPage: number | null,
  aiBbox: Box | null
): Promise<Region | null> {
  try {
    const fromText = await regionFromText(pdfjsLib, doc, label);
    if (fromText) {
      const region: Region = { page: fromText.page, bbox: fromText.bbox, source: "text", labelBox: fromText.labelBox };
      if (!fromText.open) return region; // 번호~다음 번호 사이: 그대로
      // 단의 마지막 문항이면 글줄 아래의 그림까지 들어가도록 잉크로 아래쪽만 한 번 더 넓힌다.
      const ink = await inkOf(await doc.getPage(fromText.page));
      return { ...region, bbox: { ...fromText.bbox, y1: Math.max(fromText.bbox.y1, extendDown(ink, fromText.bbox)) } };
    }
  } catch {
    /* 글자 정보를 못 읽으면 AI 영역으로 */
  }
  if (!aiPage || !aiBbox || aiPage > doc.numPages) return null;
  try {
    const pg = await doc.getPage(aiPage);
    const ink = await inkOf(pg);
    const snapped = snapToInk(ink, aiBbox, colSplit(ink));
    return snapped ? { page: aiPage, bbox: snapped, source: "ai" } : null;
  } catch {
    return { page: aiPage, bbox: aiBbox, source: "ai" };
  }
}
