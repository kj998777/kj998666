// 디지털 시험지의 그림 자리 다듬기(2026-09-29 원장님 제보: 1번 그래프 자리에 그래프 대신 선택지·다음 문제 글자가 잘려 나옴).
//
// AI가 알려 주는 그림 위치(쪽을 1000×1000으로 본 좌표)는 가끔 크게 빗나간다. 그래서 오리기 전에 원본 쪽 그림(캔버스)을
// 직접 살펴서 확인한다.
//  1. 쪽을 흑백으로 줄여서 "잉크 덩어리"(이어진 검은 점들)를 찾는다.
//  2. 그림다운 덩어리 = 가로·세로로 모두 넓게 퍼진 선 덩어리(그래프의 x·y축, 도형의 변, 표의 격자). 글자는 작은 덩어리,
//     단 구분선·밑줄은 한 방향으로만 긴 선이라 제외하고, <보기>·조건 상자 테두리(속이 빈 네모 틀)도 제외한다.
//  3. AI 영역 안에 그림다운 덩어리가 있으면 그대로 쓰되, 그 덩어리가 영역 밖으로 삐져나가면 영역을 넓혀 잘리지 않게 한다.
//  4. 없으면(글자만 잡혔으면) 같은 단 근처(위아래로 쪽 높이의 25%)에서 AI 영역에 가장 가까운 그림 덩어리를 찾아 그 자리로 옮긴다.
//  5. 그래도 못 찾으면 AI 영역 그대로 두고 "확인 필요"로 알린다.
// 2026-09-29 원장님 제보 2(그림 자리에 시험지 머리말·여러 문제가 통째로 잘려 나옴): 머리말 표 테두리·단 구분선처럼 쪽을 가로지르는
// 긴 직선이 여러 문제를 한 덩어리로 이어 붙여 "거대한 그림"이 되던 문제 → 긴 직선은 먼저 지우고 살피고, 너무 큰 덩어리는 그림으로
// 치지 않으며, AI 영역에서 크게(쪽의 12% 넘게) 벗어나게 넓히지는 않는다(그럴 땐 AI 영역을 믿는다).
// 브라우저(캔버스)와 테스트(가짜 픽셀 배열) 모두에서 쓰도록 픽셀 배열만 받는 순수 함수로 짰다.

export type Box = { x0: number; y0: number; x1: number; y1: number }; // 1000×1000 좌표
/** ok: AI 영역 그대로 · expanded: 그림에 맞춰 영역을 고침(잘림·딸려 온 글자) · moved: 근처 그림으로 옮김 · suspect: 그림을 못 찾음 */
export type RefineResult = { box: Box; status: "ok" | "expanded" | "moved" | "suspect" };

type Comp = { x0: number; y0: number; x1: number; y1: number; n: number; frame: boolean };

const WORK_W = 700; // 이 너비로 줄여서 살핀다(속도)
const MAX_GROW = 120; // AI 영역을 넓힐 때 한 변에서 최대(1000 좌표, 쪽의 12%)

/**
 * 쪽을 가로지르는 긴 직선(가로는 쪽 너비 50% 이상, 세로는 쪽 높이 40% 이상)을 지운다 — 머리말 표·단 구분선·쪽 테두리.
 * 사진·스캔은 살짝 기울어 있어 한 줄로 곧게 이어지지 않으므로, 위아래(또는 좌우) ±K칸을 한 줄로 보고 찾는다.
 */
function eraseLongLines(ink: Uint8Array, W: number, H: number) {
  const K = Math.max(3, Math.round(W / 110)); // 700 너비에서 6칸(쪽의 약 1%)
  const erase = new Uint8Array(W * H);
  // 가로선: 열마다 세로 누적합으로 "y±K 안에 잉크가 있나"를 빠르게 본다
  const colPre = new Int32Array((H + 1) * W);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) colPre[(y + 1) * W + x] = colPre[y * W + x] + (ink[y * W + x] ? 1 : 0);
  const minH = Math.round(W * 0.5);
  for (let y = 0; y < H; y++) {
    const a = Math.max(0, y - K);
    const b = Math.min(H, y + K + 1);
    let x = 0;
    while (x < W) {
      if (colPre[b * W + x] - colPre[a * W + x] === 0) {
        x++;
        continue;
      }
      let e = x;
      while (e < W && colPre[b * W + e] - colPre[a * W + e] > 0) e++;
      if (e - x >= minH) for (let yy = a; yy < b; yy++) for (let k = x; k < e; k++) erase[yy * W + k] = 1;
      x = e;
    }
  }
  // 세로선: 행마다 가로 누적합
  const rowPre = new Int32Array(H * (W + 1));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) rowPre[y * (W + 1) + x + 1] = rowPre[y * (W + 1) + x] + (ink[y * W + x] ? 1 : 0);
  const minV = Math.round(H * 0.4);
  for (let x = 0; x < W; x++) {
    const a = Math.max(0, x - K);
    const b = Math.min(W, x + K + 1);
    let y = 0;
    while (y < H) {
      if (rowPre[y * (W + 1) + b] - rowPre[y * (W + 1) + a] === 0) {
        y++;
        continue;
      }
      let e = y;
      while (e < H && rowPre[e * (W + 1) + b] - rowPre[e * (W + 1) + a] > 0) e++;
      if (e - y >= minV) for (let yy = y; yy < e; yy++) for (let k = a; k < b; k++) erase[yy * W + k] = 1;
      y = e;
    }
  }
  for (let i = 0; i < ink.length; i++) if (erase[i]) ink[i] = 0;
}

/**
 * gray: 쪽 전체의 밝기(0~255) 배열(가로 w × 세로 h). figure: AI가 준 그림 영역(1000 좌표).
 * others: 같은 쪽의 다른 그림 영역들(옮길 때 이미 다른 그림이 쓰는 덩어리는 피한다).
 */
export function refineFigureBox(gray: Uint8ClampedArray | Uint8Array, w: number, h: number, figure: Box, others: Box[] = []): RefineResult {
  const s = Math.min(1, WORK_W / w);
  const W = Math.max(1, Math.round(w * s));
  const H = Math.max(1, Math.round(h * s));
  // 줄이면서 흑백으로(칸 안에 어두운 점이 하나라도 있으면 잉크)
  const ink = new Uint8Array(W * H);
  const step = 1 / s;
  for (let y = 0; y < H; y++) {
    const sy0 = Math.floor(y * step);
    const sy1 = Math.min(h, Math.floor((y + 1) * step) || sy0 + 1);
    for (let x = 0; x < W; x++) {
      const sx0 = Math.floor(x * step);
      const sx1 = Math.min(w, Math.floor((x + 1) * step) || sx0 + 1);
      let dark = false;
      for (let yy = sy0; yy < Math.max(sy1, sy0 + 1) && !dark; yy++) {
        const row = yy * w;
        for (let xx = sx0; xx < Math.max(sx1, sx0 + 1); xx++) {
          if (gray[row + xx] < 150) {
            dark = true;
            break;
          }
        }
      }
      ink[y * W + x] = dark ? 1 : 0;
    }
  }
  eraseLongLines(ink, W, H);
  const comps = components(ink, W, H);
  const toK = (c: { x0: number; y0: number; x1: number; y1: number }): Box => ({
    x0: (c.x0 / W) * 1000,
    y0: (c.y0 / H) * 1000,
    x1: ((c.x1 + 1) / W) * 1000,
    y1: ((c.y1 + 1) / H) * 1000,
  });
  // 그림다운 덩어리(쪽 1000 좌표 기준 가로 ≥ 8%, 세로 ≥ 5%, 한 방향 선·네모 틀 제외)
  const figs: Box[] = [];
  const frames: Box[] = [];
  const small: Box[] = [];
  for (const c of comps) {
    const b = toK(c);
    const bw = b.x1 - b.x0;
    const bh = b.y1 - b.y0;
    // 쪽의 35%를 넘게 차지하거나 세로로 60%를 넘는 덩어리는 그림이 아니라 쪽 틀·여러 문제가 이어 붙은 것
    const tooBig = bw * bh > 350000 || bh > 600;
    const figureLike = bw >= 80 && bh >= 50 && bw <= 980 && !tooBig;
    const frame = c.frame; // 속이 빈 네모 틀(<보기>·조건 상자 테두리)
    if (figureLike && !frame) figs.push(b);
    else if (figureLike && frame) frames.push(b);
    else if (bw < 60 && bh < 40) small.push(b);
  }
  const fb = norm(figure);
  const inter = (a: Box, b: Box) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const area = (a: Box) => Math.max(0, a.x1 - a.x0) * Math.max(0, a.y1 - a.y0);
  const takenByOther = (b: Box) => others.some((o) => inter(norm(o), b) > 0.5 * area(b));

  // 3. AI 영역과 많이 겹치는 그림 덩어리
  // (네모 틀도 AI가 일부러 그림으로 짚은 것이면 그대로 인정 — 옮길 후보로는 쓰지 않음)
  const hit = (b: Box) => inter(b, fb) >= 0.35 * area(b) || inter(b, fb) >= 0.5 * area(fb);
  const hitFigs = figs.filter(hit);
  const hitFrames = frames.filter(hit);
  if (hitFigs.length || hitFrames.length) {
    // 그림 덩어리(+ 바로 옆 눈금·점 이름)와 틀만으로 새 영역을 만든다 — AI 영역에 딸려 온 글자 줄은 버린다
    let u: Box | null = hitFigs.length ? grow(hitFigs.reduce(union), small) : null;
    for (const f of hitFrames) u = u ? union(u, f) : f;
    const out = clampBox(pad(u as Box, 6));
    // 새 영역이 AI 영역 안에 거의 다 들어가고 AI 영역이 지나치게 크지 않으면 AI 영역을 그대로 쓴다
    const inside = out.x0 >= fb.x0 - 8 && out.y0 >= fb.y0 - 8 && out.x1 <= fb.x1 + 8 && out.y1 <= fb.y1 + 8;
    if (inside && area(fb) <= 1.6 * area(out)) return { box: fb, status: "ok" };
    // AI 영역에서 크게 벗어나게 넓혀야 하면(다른 문제·머리말까지 딸려 올 위험) 넓히지 않고 AI 영역을 믿는다
    const M = MAX_GROW;
    if (out.x0 < fb.x0 - M || out.y0 < fb.y0 - M || out.x1 > fb.x1 + M || out.y1 > fb.y1 + M) return { box: fb, status: "ok" };
    return { box: out, status: "expanded" };
  }
  // 4. 근처에서 가장 가까운 그림 덩어리로 옮기기(같은 단: 가로 중심이 AI 영역 가로 범위 ±15% 안, 세로 ±25%)
  const cx = (fb.x0 + fb.x1) / 2;
  const cy = (fb.y0 + fb.y1) / 2;
  const near = figs
    .filter((b) => !takenByOther(b))
    .filter((b) => {
      const bx = (b.x0 + b.x1) / 2;
      const by = (b.y0 + b.y1) / 2;
      return bx >= fb.x0 - 150 && bx <= fb.x1 + 150 && Math.abs(by - cy) <= 250 + (fb.y1 - fb.y0) / 2;
    })
    .map((b) => ({ b, d: Math.hypot((b.x0 + b.x1) / 2 - cx, (b.y0 + b.y1) / 2 - cy) }))
    .sort((a, b) => a.d - b.d);
  if (near.length) {
    const u = grow(near[0].b, small);
    return { box: clampBox(pad(u, 6)), status: "moved" };
  }
  return { box: fb, status: "suspect" };
}

function norm(b: Box): Box {
  return { x0: Math.min(b.x0, b.x1), y0: Math.min(b.y0, b.y1), x1: Math.max(b.x0, b.x1), y1: Math.max(b.y0, b.y1) };
}
function union(a: Box, b: Box): Box {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}
function pad(b: Box, p: number): Box {
  return { x0: b.x0 - p, y0: b.y0 - p, x1: b.x1 + p, y1: b.y1 + p };
}
function clampBox(b: Box): Box {
  const c = (v: number) => Math.max(0, Math.min(1000, Math.round(v)));
  return { x0: c(b.x0), y0: c(b.y0), x1: c(b.x1), y1: c(b.y1) };
}
/** 그림 바로 옆·안의 작은 덩어리(눈금 숫자, 점 이름 O·A·B, x·y 글자)를 그림에 붙인다. 문제 글 줄까지 끌어오지 않게 가까운 것만. */
function grow(b: Box, small: Box[]): Box {
  let u = b;
  const M = 14; // 1000 좌표로 약 1.4%
  for (let k = 0; k < 3; k++) {
    let changed = false;
    for (const t of small) {
      if (t.x1 >= u.x0 - M && t.x0 <= u.x1 + M && t.y1 >= u.y0 - M && t.y0 <= u.y1 + M) {
        const nu = union(u, t);
        if (nu.x0 !== u.x0 || nu.y0 !== u.y0 || nu.x1 !== u.x1 || nu.y1 !== u.y1) {
          u = nu;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return u;
}

/** 8방향으로 이어진 잉크 덩어리 찾기. frame = 속이 빈 네모 틀인지. */
function components(ink: Uint8Array, W: number, H: number): Comp[] {
  const label = new Int32Array(W * H);
  const out: Comp[] = [];
  const stack = new Int32Array(W * H);
  let id = 0;
  for (let p = 0; p < W * H; p++) {
    if (!ink[p] || label[p]) continue;
    id++;
    let sp = 0;
    stack[sp++] = p;
    label[p] = id;
    let x0 = W, y0 = H, x1 = -1, y1 = -1, n = 0;
    const pts: number[] = [];
    while (sp) {
      const q = stack[--sp];
      const qx = q % W;
      const qy = (q / W) | 0;
      n++;
      if (pts.length < 200000) pts.push(q);
      if (qx < x0) x0 = qx;
      if (qx > x1) x1 = qx;
      if (qy < y0) y0 = qy;
      if (qy > y1) y1 = qy;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = qy + dy;
        if (ny < 0 || ny >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = qx + dx;
          if (nx < 0 || nx >= W) continue;
          const r = ny * W + nx;
          if (ink[r] && !label[r]) {
            label[r] = id;
            stack[sp++] = r;
          }
        }
      }
    }
    // 네모 틀 판별: 네 변이 모두 거의 다 그어져 있고(각 변 80% 이상) 안쪽에는 점이 거의 없음(10% 미만).
    // 1사분면 그래프처럼 두 변(축)만 있는 것, 안에 칸막이 선이 있는 표는 틀이 아니다.
    const m = 2;
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    let frame = false;
    if (bw > 10 && bh > 10) {
      const top = new Uint8Array(bw), bot = new Uint8Array(bw), lef = new Uint8Array(bh), rig = new Uint8Array(bh);
      let inner = 0;
      for (const q of pts) {
        const qx = q % W;
        const qy = (q / W) | 0;
        const nearEdge = qx - x0 < m || x1 - qx < m || qy - y0 < m || y1 - qy < m;
        if (qy - y0 < m) top[qx - x0] = 1;
        if (y1 - qy < m) bot[qx - x0] = 1;
        if (qx - x0 < m) lef[qy - y0] = 1;
        if (x1 - qx < m) rig[qy - y0] = 1;
        if (!nearEdge) inner++;
      }
      const cov = (a: Uint8Array) => a.reduce((t, v) => t + v, 0) / a.length;
      frame = cov(top) > 0.8 && cov(bot) > 0.8 && cov(lef) > 0.8 && cov(rig) > 0.8 && inner / Math.max(1, pts.length) < 0.1;
    }
    out.push({ x0, y0, x1, y1, n, frame });
  }
  return out;
}

/** 캔버스에서 밝기 배열 뽑기(브라우저 전용 도우미). */
export function canvasGray(cv: HTMLCanvasElement): { gray: Uint8ClampedArray; w: number; h: number } {
  const ctx = cv.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const gray = new Uint8ClampedArray(cv.width * cv.height);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) gray[j] = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) | 0;
  return { gray, w: cv.width, h: cv.height };
}
