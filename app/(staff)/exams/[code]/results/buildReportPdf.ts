// 브라우저에서 "성적 보고서"(종합/개별) PDF를 만든다.
//
// 옛 Apps Script 시스템의 파이썬 스크립트(claude/dg2025-report-content.md의 content.py/build.py/
// render.py)를 그대로 이식한 것이 아니라, 그 스크립트가 "특정 시험(DG2025) 하나"에 손으로 채워
// 넣었던 단원·난이도·해설·응시자 데이터를 이 사이트의 실제 테이블(answer_key,
// item_explanations, submissions+grading_results, exam_notes)에서 그대로 읽어 **어떤 시험이든**
// 같은 양식으로 만들 수 있게 일반화한 버전이다. 영역(area)·난이도(difficulty)는 AI가 문항을 풀 때
// item_explanations 에 이미 저장해 둔 값을 그대로 쓴다(lib/ai/prompts.ts의 SOLVE_TOOL 참고 — 옛
// 시스템의 DOMAIN 표를 사람이 손으로 만드는 대신 AI 결과를 그대로 재사용).
//
// PDF 렌더링은 디지털화 기능(buildDigitizedPdf.ts)과 같은 방식 — 서버에 헤드리스 브라우저가 없어
// (Vercel 서버리스 + Playwright 불가) html2canvas(html2pdf.js 경유)로 렌더링한 "그림으로 된"
// PDF다(옛 시스템은 Playwright로 실제 텍스트 PDF를 만들었지만 이 사이트에서는 재현할 수 없는
// 부분 — 디지털화 기능과 같은 한계). 다만 쪽 번호만은 jsPDF의 텍스트 API로 각 쪽에 직접 그려
// 넣어 최소한 그 부분은 실제 텍스트다.

export type ReportItem = {
  label: string;
  points: number;
  type: "객관식" | "주관식";
  correct_answers: string;
  area: string;
  unit: string;
  difficulty: "하" | "중하" | "중" | "중상" | "상";
  difficulty_reason: string;
  problem_statement: string;
  answer_display: string;
  solution: string;
  points_assigned: boolean;
  exam_error_suspected: boolean;
};

export type ReportPerItem = { item_label: string; given: string; correct: boolean; points: number };

export type ReportStudent = {
  id: string;
  class_label: string;
  student_name: string;
  submitted_at: string;
  total_score: number;
  per_item: ReportPerItem[];
};

export type ReportData = {
  exam: { code: string; name: string };
  items: ReportItem[];
  students: ReportStudent[];
  notes: string[];
  corrections: { item_label: string; issue: string; fix: string; teacher_note: string }[];
};

// ---------------------------------------------------------------------
// 외부 라이브러리 CDN 로드 (buildDigitizedPdf.ts와 같은 방식 — 세션당 한 번만, 전역 캐시)
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

// 보고서 PDF는 html2canvas(쪽 그림) + jsPDF(PDF 조립)를 직접 쓴다. 예전에는 html2pdf.js 묶음을 썼는데,
// 그 묶음은 이 둘을 밖으로 노출하지 않고, 자체 작업 틀의 폭이 A4 본문 폭(190mm ≈ 718px)으로 고정돼
// 760px 폭의 보고서 오른쪽 끝이 잘렸다(아래 "보고서 잘림" 설명 참고).
let pdfToolsReady: Promise<void> | null = null;
function loadPdfTools(): Promise<void> {
  if (!pdfToolsReady) {
    pdfToolsReady = (async () => {
      const g = window as any;
      if (!g.html2canvas) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");
      if (!g.jspdf?.jsPDF) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
    })().catch((e) => {
      pdfToolsReady = null; // 다음에 다시 시도할 수 있게
      throw e;
    });
  }
  return pdfToolsReady;
}

let jszipReady: Promise<any> | null = null;
function loadJsZip(): Promise<any> {
  if (!jszipReady) {
    jszipReady = (async () => {
      if ((window as any).JSZip) return (window as any).JSZip;
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js");
      return (window as any).JSZip;
    })();
  }
  return jszipReady;
}

// ---------------------------------------------------------------------
// 글·수식 렌더링 ($...$ 는 KaTeX, <b>/<br> 만 허용하고 그 밖의 홑화살괄호는 이스케이프)
// ---------------------------------------------------------------------

function esc(s: unknown): string {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function sanitizeAllowed(s: string): string {
  const out = esc(s);
  return out.replace(/&lt;(\/?)(b|br)\s*\/?&gt;/gi, (_m, slash, tag) => `<${slash}${String(tag).toLowerCase()}>`);
}

function mathHtml(katex: any, text: string | null | undefined): string {
  // $ 가 홀수 개면(마지막 수식이 닫히지 않음) 마지막 조각만 글자 그대로 두고(먹힌 $ 복원),
  // 그 앞의 정상 수식은 그대로 렌더링한다 — 문자열 전체를 통째로 포기하면 문항 하나에 $ 가
  // 하나만 빠져도 그 문항의 모든 수식이 명령어 글자 그대로 남는 문제가 생긴다
  // (buildDigitizedPdf.ts의 dgTex()에서 실제로 신고된 버그와 같은 원인이라 여기서도 함께 고쳤다).
  const s = String(text == null ? "" : text);
  const parts = s.split("$");
  const unpaired = parts.length % 2 === 0;
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const isTrailingUnpaired = unpaired && i === parts.length - 1;
    if (i % 2 === 1 && !isTrailingUnpaired) {
      try {
        out.push(katex.renderToString(parts[i], { throwOnError: false }));
      } catch {
        out.push(esc(parts[i]));
      }
    } else {
      const t = isTrailingUnpaired ? "$" + parts[i] : parts[i];
      out.push(sanitizeAllowed(t).replace(/\n/g, "<br>"));
    }
  }
  return out.join("");
}

function fmt(n: number): string {
  const r = Math.round((n + 1e-9) * 100) / 100;
  return String(r);
}
function pct(a: number, b: number): number {
  return b > 0 ? Math.round((100 * a) / b) : 0;
}

// ---------------------------------------------------------------------
// CSS (옛 build.py의 CSS를 이식 — .rpt 아래로 전부 감싸 이 사이트의 전역 .card/.badge 등과
// 이름이 겹치지 않게 했다. break-before/break-inside 는 신형·구형 속성을 함께 넣어 html2pdf.js의
// pagebreak 플러그인이 인식하게 했다.)
// ---------------------------------------------------------------------

let stylesInjected = false;
function injectReportStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const css = `
.rpt { width: 760px; background:#fff; color:#1f2937; font-family:'Noto Sans CJK KR','Noto Sans KR','Malgun Gothic','Apple SD Gothic Neo',sans-serif; font-size:13px; line-height:1.55; padding: 4px; }
.rpt * { box-sizing: border-box; overflow-wrap: anywhere; word-break: break-word; min-width: 0; }
.rpt h1 { font-size: 23px; margin: 0 0 3px; color:#0f2a4a; letter-spacing:-0.3px; }
.rpt h2 { font-size: 16px; margin: 16px 0 6px; color:#0f2a4a; border-left: 4px solid #2563eb; padding-left: 8px; break-after: avoid; page-break-after: avoid; }
.rpt h3 { font-size: 13px; margin: 8px 0 3px; color:#1e3a5f; break-after: avoid; page-break-after: avoid; }
.rpt p { margin: 3px 0; }
.rpt .rpt-sub { color:#52606d; font-size: 12px; margin-bottom: 8px; }
.rpt .rpt-box { border: 1px solid #cbd5e1; background:#f8fafc; border-radius: 6px; padding: 6px 8px; margin: 6px 0; font-size: 11.5px; }
.rpt .rpt-box.warn { border-color:#f59e0b; background:#fffbeb; }
.rpt .rpt-box b { color:#0f2a4a; }
.rpt table { border-collapse: collapse; width: 100%; table-layout: fixed; margin: 4px 0 6px; font-size: 11px; }
.rpt th, .rpt td { border: 1px solid #cbd5e1; padding: 3px 4px; vertical-align: middle; }
.rpt th { background:#eaf0f8; color:#0f2a4a; font-weight:700; text-align:center; }
.rpt td.c { text-align:center; }
.rpt td.l { text-align:left; }
.rpt tr { break-inside: avoid; page-break-inside: avoid; }
.rpt .rpt-ok { color:#15803d; font-weight:700; }
.rpt .rpt-bad { color:#b91c1c; font-weight:700; }
.rpt .rpt-blk { color:#92400e; font-weight:700; }
.rpt tr.rpt-rbad td { background:#fef2f2; }
.rpt tr.rpt-rblk td { background:#fffbeb; }
.rpt .rpt-bd { display:inline-block; min-width:20px; text-align:center; border-radius:9px; padding:1px 7px; font-size:10.5px; font-weight:700; color:#fff; }
.rpt .rpt-d1 { background:#16a34a; } .rpt .rpt-d2 { background:#65a30d; } .rpt .rpt-d3 { background:#ca8a04; } .rpt .rpt-d4 { background:#ea580c; } .rpt .rpt-d5 { background:#dc2626; }
.rpt .rpt-big { display:flex; gap:6px; margin:6px 0; }
.rpt .rpt-big > div { flex:1; border:1px solid #cbd5e1; border-radius:6px; padding:5px 6px; text-align:center; background:#fff; }
.rpt .rpt-big .n { font-size:20px; font-weight:700; color:#1d4ed8; line-height:1.2; }
.rpt .rpt-big .t { font-size:11px; color:#52606d; }
.rpt .rpt-card { border:1px solid #cbd5e1; border-radius:6px; padding:6px 8px; margin:6px 0; break-inside: avoid; page-break-inside: avoid; }
.rpt .rpt-card .hd { font-weight:700; color:#0f2a4a; margin-bottom:2px; }
.rpt .rpt-card .st { color:#374151; font-size:12px; margin:2px 0 5px; }
.rpt .rpt-card .row { display:flex; gap:6px; margin:3px 0; flex-wrap: wrap; }
.rpt .rpt-pill { border-radius:4px; padding:2px 6px; font-size:11.5px; }
.rpt .rpt-pill.mine { background:#fef2f2; border:1px solid #fecaca; }
.rpt .rpt-pill.mine.blank { background:#fffbeb; border-color:#fde68a; }
.rpt .rpt-pill.key { background:#ecfdf5; border:1px solid #a7f3d0; }
.rpt .rpt-sol { font-size:12px; border-top:1px dashed #cbd5e1; padding-top:3px; margin-top:3px; }
.rpt .rpt-small { font-size:10.5px; color:#52606d; }
.rpt .rpt-foot { color:#6b7280; font-size:10px; }
.rpt .rpt-pagebreak { break-before: page; page-break-before: always; }
.rpt .rpt-rowh { display:flex; justify-content:space-between; align-items:flex-end; border-bottom:2px solid #2563eb; padding-bottom:4px; margin-bottom:8px; }
.rpt .rpt-tag { display:inline-block; border:1px solid #f59e0b; color:#92400e; background:#fffbeb; border-radius:4px; padding:1px 7px; font-size:11px; font-weight:700; }
.rpt code.v { font-family: monospace; background:#f1f5f9; padding:0 3px; border-radius:3px; }
.rpt ul.rpt-cols { columns:2; column-gap:14px; }
.rpt ul.rpt-cols li { break-inside: avoid; page-break-inside: avoid; }
.rpt ul { margin:2px 0 2px 12px; padding:0; } .rpt li { margin: 1.5px 0; }
.rpt .katex { font-size: 1.02em; }
`;
  const style = document.createElement("style");
  style.id = "rpt-pdf-inline-styles";
  style.textContent = css;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------
// 데이터 모델 계산
// ---------------------------------------------------------------------

const DIFFS: ReportItem["difficulty"][] = ["하", "중하", "중", "중상", "상"];
const DIFF_CLASS: Record<string, string> = { 하: "rpt-d1", 중하: "rpt-d2", 중: "rpt-d3", 중상: "rpt-d4", 상: "rpt-d5" };
const CIRC: Record<string, string> = { "1": "①", "2": "②", "3": "③", "4": "④", "5": "⑤" };

type Status = "ok" | "wrong" | "blank";

function indexPerItem(s: ReportStudent): Map<string, ReportPerItem> {
  const m = new Map<string, ReportPerItem>();
  for (const p of s.per_item) m.set(p.item_label, p);
  return m;
}

function statusOf(idx: Map<string, ReportPerItem>, label: string): Status {
  const p = idx.get(label);
  if (!p) return "blank";
  if (p.correct) return "ok";
  return p.given === "" ? "blank" : "wrong";
}

function givenDisplay(item: ReportItem, idx: Map<string, ReportPerItem>): string {
  const p = idx.get(item.label);
  const g = p?.given ?? "";
  if (g === "") return "무응답";
  if (item.type === "객관식" && CIRC[g]) return CIRC[g];
  return g;
}

function statusClass(r: Status): string {
  return r === "ok" ? "rpt-ok" : r === "wrong" ? "rpt-bad" : "rpt-blk";
}
function statusMark(r: Status): string {
  return r === "ok" ? "○" : r === "wrong" ? "×" : "무응답";
}
function rowClass(r: Status): string {
  return r === "wrong" ? "rpt-rbad" : r === "blank" ? "rpt-rblk" : "";
}
function badge(d: string): string {
  return `<span class="rpt-bd ${DIFF_CLASS[d] || "rpt-d3"}">${esc(d)}</span>`;
}

function buildDomains(items: ReportItem[]): [string, ReportItem[]][] {
  const map = new Map<string, ReportItem[]>();
  for (const it of items) {
    const key = it.area && it.area.trim() ? it.area.trim() : "";
    if (!key) continue; // 영역 정보가 없는 문항은 영역별 표에서 제외
    const list = map.get(key) ?? [];
    list.push(it);
    map.set(key, list);
  }
  return Array.from(map.entries());
}

function totalOf(items: ReportItem[]): number {
  return items.reduce((s, it) => s + it.points, 0);
}
function earnedOf(items: ReportItem[], idx: Map<string, ReportPerItem>): number {
  return items.reduce((s, it) => s + (statusOf(idx, it.label) === "ok" ? it.points : 0), 0);
}

function methodNote(items: ReportData["items"]): string {
  const assigned = items.filter((i) => i.points_assigned).map((i) => i.label);
  return (
    '<div class="rpt-box"><b>읽는 방법</b><br>' +
    "· <b>난이도(하·중하·중·중상·상)</b>는 AI가 문제를 직접 풀어 본 뒤 판단한 값이며, 실제 정답률이 아닙니다.<br>" +
    (assigned.length
      ? `· <b>배점</b>은 시험지 인쇄 값을 따랐고, 인쇄되지 않은 문항(${esc(assigned.join(", "))})은 전체 합이 100점이 되도록 임의로 배정했습니다(표에 *로 표시).<br>`
      : "") +
    "· 등급 구분이나 예상 등급은 표시하지 않습니다.</div>"
  );
}

// ---------------------------------------------------------------------
// 종합 보고서
// ---------------------------------------------------------------------

export function buildSummaryHtml(katex: any, data: ReportData): string {
  const items = data.items;
  const students = data.students;
  const n = students.length;
  const idxOf = new Map(students.map((s) => [s.id, indexPerItem(s)]));
  const totalPoints = totalOf(items);
  const domains = buildDomains(items);
  const diffCells = new Map(DIFFS.map((d) => [d, items.filter((i) => i.difficulty === d)]));

  const b: string[] = [];
  b.push(
    `<div class="rpt-rowh"><div><h1>종합 보고서</h1><div class="rpt-sub" style="margin:0">${esc(
      data.exam.name
    )} · 응시 ${n}명</div></div></div>`
  );

  if (n === 0) {
    b.push('<div class="rpt-box warn">아직 제출한 학생이 없습니다.</div>');
    return `<div class="rpt">${b.join("")}</div>`;
  }

  const totals = students.map((s) => Number(s.total_score));
  const avg = Math.round((totals.reduce((a, x) => a + x, 0) / n) * 100) / 100;
  b.push(
    `<div class="rpt-big"><div><div class="n">${n}명</div><div class="t">응시 인원</div></div>` +
      `<div><div class="n">${fmt(avg)}점</div><div class="t">평균</div></div>` +
      `<div><div class="n">${fmt(Math.max(...totals))}점</div><div class="t">최고</div></div>` +
      `<div><div class="n">${fmt(Math.min(...totals))}점</div><div class="t">최저</div></div>` +
      `<div><div class="n">${fmt(totalPoints)}점</div><div class="t">배점 합</div></div></div>`
  );

  // 1. 응시자별 결과
  b.push("<h2>1. 응시자별 결과</h2>");
  b.push(
    "<table><thead><tr><th>반</th><th>이름</th><th>총점</th><th>정답 수 (/" +
      items.length +
      ")</th><th>오답 문항</th><th>무응답 문항</th></tr></thead><tbody>"
  );
  for (const s of students) {
    const idx = idxOf.get(s.id)!;
    const wrong = items.filter((it) => statusOf(idx, it.label) === "wrong").map((it) => it.label);
    const blank = items.filter((it) => statusOf(idx, it.label) === "blank").map((it) => it.label);
    const ok = items.filter((it) => statusOf(idx, it.label) === "ok").length;
    b.push(
      `<tr><td class="c">${esc(s.class_label)}</td><td class="c">${esc(s.student_name)}</td><td class="c"><b>${fmt(
        s.total_score
      )}</b></td><td class="c">${ok}</td><td class="l rpt-small">${esc(wrong.join(", ") || "-")}</td><td class="l rpt-small">${esc(
        blank.join(", ") || "-"
      )}</td></tr>`
    );
  }
  b.push("</tbody></table>");

  // 2. 영역별 득점
  if (domains.length) {
    b.push("<h2>2. 영역별 득점</h2>");
    b.push(
      "<table><thead><tr><th>영역</th><th>포함 문항</th><th>배점</th><th>평균 득점</th><th>전체 득점률</th></tr></thead><tbody>"
    );
    for (const [d, cells] of domains) {
      const tot = totalOf(cells);
      let gsum = 0;
      for (const s of students) gsum += earnedOf(cells, idxOf.get(s.id)!);
      const avgG = n ? Math.round((gsum / n) * 100) / 100 : 0;
      b.push(
        `<tr><td class="c"><b>${esc(d)}</b></td><td class="l rpt-small">${esc(cells.map((c) => c.label).join(", "))}</td><td class="c">${fmt(
          tot
        )}</td><td class="c">${fmt(avgG)}</td><td class="c"><b>${pct(gsum, tot * n)}%</b></td></tr>`
      );
    }
    b.push("</tbody></table>");
  }

  // 3. 난이도별 정답 현황
  b.push("<h2>3. 난이도별 정답 현황</h2>");
  b.push("<table><thead><tr><th>난이도</th><th>문항 수</th><th>해당 문항</th><th>전체 정답률</th></tr></thead><tbody>");
  for (const d of DIFFS) {
    const cells = diffCells.get(d) || [];
    if (!cells.length) continue;
    let okall = 0;
    for (const s of students) {
      const idx = idxOf.get(s.id)!;
      okall += cells.filter((c) => statusOf(idx, c.label) === "ok").length;
    }
    b.push(
      `<tr><td class="c">${badge(d)}</td><td class="c">${cells.length}</td><td class="l rpt-small">${esc(
        cells.map((c) => c.label).join(", ")
      )}</td><td class="c"><b>${pct(okall, cells.length * n)}%</b></td></tr>`
    );
  }
  b.push("</tbody></table>");
  b.push('<p class="rpt-small">난이도가 높을수록 정답률이 낮아지는 모양이 실제와 맞는지 참고해 보세요.</p>');

  // 4. 문항별 분석
  b.push('<h2 class="rpt-pagebreak">4. 문항별 분석</h2>');
  b.push(
    "<table><thead><tr><th>문항</th><th>단원</th><th>배점</th><th>난이도</th><th>정답</th><th>정답 인원</th><th>오답·무응답 내용</th></tr></thead><tbody>"
  );
  for (const it of items) {
    let nok = 0;
    const detail: string[] = [];
    for (const s of students) {
      const idx = idxOf.get(s.id)!;
      const r = statusOf(idx, it.label);
      if (r === "ok") nok++;
      else detail.push(`${s.student_name}: ${r === "blank" ? "무응답" : givenDisplay(it, idx)}`);
    }
    const rc = n > 0 && nok / n <= 0.3 ? "rpt-rbad" : "";
    const detailTxt = detail.length > 12 ? `오답·무응답 ${detail.length}명 (지면 관계상 생략)` : detail.join(" · ") || "-";
    b.push(
      `<tr class="${rc}"><td class="c"><b>${esc(it.label)}</b></td><td class="l rpt-small">${esc(it.unit)}</td><td class="c">${fmt(
        it.points
      )}${it.points_assigned ? "*" : ""}</td><td class="c">${badge(it.difficulty)}</td><td class="c">${mathHtml(
        katex,
        it.answer_display
      )}</td><td class="c">${nok}/${n}</td><td class="l rpt-small">${esc(detailTxt)}</td></tr>`
    );
  }
  b.push("</tbody></table>");
  b.push('<p class="rpt-small">* 시험지에 배점이 인쇄되지 않아 임의로 배정한 문항. 붉은 배경은 정답률 30% 이하인 문항.</p>');

  // 5. 난이도 판정 근거
  b.push("<h2>5. 문항별 난이도 판정 근거</h2>");
  b.push("<table><thead><tr><th>문항</th><th>단원</th><th>난이도</th><th>판정 근거</th></tr></thead><tbody>");
  for (const it of items) {
    b.push(
      `<tr><td class="c"><b>${esc(it.label)}</b></td><td class="l rpt-small">${esc(it.unit)}</td><td class="c">${badge(
        it.difficulty
      )}</td><td class="l">${mathHtml(katex, it.difficulty_reason)}</td></tr>`
    );
  }
  b.push("</tbody></table>");

  // 6. 수업에서 다시 다룰 만한 문항
  const hard = items
    .map((it) => {
      let ok = 0;
      for (const s of students) if (statusOf(idxOf.get(s.id)!, it.label) === "ok") ok++;
      return { it, ok };
    })
    .filter((x) => n > 0 && x.ok / n <= 0.3);
  b.push("<h2>6. 수업에서 다시 다룰 만한 문항</h2>");
  if (hard.length) {
    b.push("<p>정답률이 30% 이하였던 문항입니다.</p><ul>");
    for (const { it, ok } of hard) {
      b.push(
        `<li><b>${esc(it.label)}번</b> (${esc(it.unit)}, ${esc(it.difficulty)}, 정답 ${ok}/${n}) — ${mathHtml(
          katex,
          it.difficulty_reason
        )}</li>`
      );
    }
    b.push("</ul>");
  } else {
    b.push('<p class="rpt-small">정답률이 30% 이하로 떨어진 문항은 없었습니다.</p>');
  }

  // 7. 시험지·해설 확인 사항
  if (data.notes.length || data.corrections.length) {
    b.push("<h2>7. 시험지·해설에서 확인한 점</h2><ul>");
    for (const note of data.notes) b.push(`<li>${mathHtml(katex, note)}</li>`);
    for (const c of data.corrections) {
      if (c.teacher_note) b.push(`<li><b>${esc(c.item_label)}번</b> — ${mathHtml(katex, c.teacher_note)}</li>`);
    }
    b.push("</ul>");
  }

  // 8. 학생별 요약
  b.push("<h2>8. 학생별 요약</h2>");
  b.push(
    "<table><thead><tr><th>이름</th><th>총점</th>" +
      (domains.length ? "<th>강한 영역</th><th>보완 영역</th>" : "") +
      "</tr></thead><tbody>"
  );
  for (const s of students) {
    const idx = idxOf.get(s.id)!;
    let extra = "";
    if (domains.length) {
      const rates = domains.map(([d, cells]) => ({ d, rate: earnedOf(cells, idx) / (totalOf(cells) || 1) }));
      const best = rates.reduce((a, b2) => (b2.rate > a.rate ? b2 : a));
      const worst = rates.reduce((a, b2) => (b2.rate < a.rate ? b2 : a));
      extra = `<td class="c">${esc(best.d)} (${Math.round(best.rate * 100)}%)</td><td class="c">${esc(worst.d)} (${Math.round(
        worst.rate * 100
      )}%)</td>`;
    }
    b.push(`<tr><td class="c">${esc(s.student_name)}</td><td class="c">${fmt(s.total_score)}</td>${extra}</tr>`);
  }
  b.push("</tbody></table>");
  b.push(methodNote(items));

  return `<div class="rpt">${b.join("")}</div>`;
}

// ---------------------------------------------------------------------
// 개별 보고서
// ---------------------------------------------------------------------

function buildAdvice(items: ReportItem[], student: ReportStudent, idx: Map<string, ReportPerItem>, domains: [string, ReportItem[]][]): string {
  const totalPoints = totalOf(items);
  const ok = items.filter((it) => statusOf(idx, it.label) === "ok").length;
  const missed = items.filter((it) => statusOf(idx, it.label) !== "ok");

  if (missed.length === 0) {
    return `${items.length}문항을 모두 맞혀 ${fmt(student.total_score)}점입니다. 난이도가 높은 문항까지 안정적으로 다룬 것으로 보입니다. 서술형 문항은 최종 답만 채점되므로, 답안을 논리적으로 서술하는 연습을 함께 해 보면 좋습니다.`;
  }

  let s = `${items.length}문항 중 ${ok}문항을 맞혀 ${fmt(student.total_score)}점입니다.`;
  if (domains.length) {
    const rates = domains.map(([d, cells]) => ({ d, rate: earnedOf(cells, idx) / (totalOf(cells) || 1) }));
    const best = rates.reduce((a, b) => (b.rate > a.rate ? b : a));
    const worst = rates.reduce((a, b) => (b.rate < a.rate ? b : a));
    if (best.d !== worst.d) {
      s += ` 영역별로는 ${best.d}(득점률 ${Math.round(best.rate * 100)}%)에서 가장 안정적이었고, ${worst.d}(득점률 ${Math.round(
        worst.rate * 100
      )}%)이 상대적으로 약했습니다.`;
    }
  }
  const missedEasy = missed.filter((it) => it.difficulty === "하" || it.difficulty === "중하");
  if (missedEasy.length > 0) {
    s += ` 놓친 문항 중 ${missedEasy.map((it) => it.label).join(", ")}번은 난이도가 낮은 편이라, 공식·개념을 그대로 적용하는 문항부터 확실히 챙기면 점수를 올리는 데 가장 빠른 길이 될 수 있습니다.`;
  } else {
    s += ` 놓친 문항이 대부분 난이도 ‘중상’ 이상이라, 기본기는 안정적이고 경우 분류나 여러 단계를 거치는 심화 문항 연습이 남은 과제로 보입니다.`;
  }
  return s;
}

export function buildIndividualHtml(katex: any, data: ReportData, student: ReportStudent): string {
  const items = data.items;
  const idx = indexPerItem(student);
  const domains = buildDomains(items);
  const diffCells = new Map(DIFFS.map((d) => [d, items.filter((i) => i.difficulty === d)]));
  const ok = items.filter((it) => statusOf(idx, it.label) === "ok").length;
  const missed = items.filter((it) => statusOf(idx, it.label) !== "ok");
  const wrongN = items.filter((it) => statusOf(idx, it.label) === "wrong").length;
  const blankN = items.filter((it) => statusOf(idx, it.label) === "blank").length;
  const totalPoints = totalOf(items);
  const rate = totalPoints > 0 ? student.total_score / totalPoints : 1;

  const b: string[] = [];
  b.push(
    `<div class="rpt-rowh"><div><h1>개별 성적 보고서</h1><div class="rpt-sub" style="margin:0">${esc(
      data.exam.name
    )}</div></div></div>`
  );
  b.push(
    `<div class="rpt-big"><div><div class="n" style="font-size:16px">${esc(student.student_name)}</div><div class="t">${esc(
      student.class_label
    )}</div></div><div><div class="n">${fmt(student.total_score)}점</div><div class="t">총점 (${fmt(
      totalPoints
    )}점 만점)</div></div><div><div class="n">${ok} / ${items.length}</div><div class="t">정답 문항 수</div></div><div><div class="n">${
      missed.length
    }개</div><div class="t">오답 ${wrongN} · 무응답 ${blankN}</div></div></div>`
  );

  b.push("<h2>1. 종합 의견</h2>");
  b.push(`<p>${buildAdvice(items, student, idx, domains)}</p>`);

  if (domains.length) {
    b.push("<h2>2. 영역별·난이도별 결과</h2>");
    b.push("<table><thead><tr><th>영역</th><th>포함 문항</th><th>득점 / 배점</th><th>득점률</th></tr></thead><tbody>");
    for (const [d, cells] of domains) {
      const g = earnedOf(cells, idx);
      const t = totalOf(cells);
      b.push(
        `<tr><td class="c"><b>${esc(d)}</b></td><td class="l rpt-small">${esc(cells.map((c) => c.label).join(", "))}</td><td class="c">${fmt(
          g
        )} / ${fmt(t)}</td><td class="c">${pct(g, t)}%</td></tr>`
      );
    }
    b.push("</tbody></table>");
  }
  b.push('<table><thead><tr><th>난이도</th>' + DIFFS.map((d) => `<th>${badge(d)}</th>`).join("") + "</tr></thead><tbody><tr><td class=\"c\">맞힌 문항 / 전체</td>");
  for (const d of DIFFS) {
    const cells = diffCells.get(d) || [];
    const k = cells.filter((c) => statusOf(idx, c.label) === "ok").length;
    b.push(`<td class="c">${k} / ${cells.length}</td>`);
  }
  b.push("</tr></tbody></table>");

  b.push("<h2>3. 문항별 난이도와 결과</h2>");
  b.push(
    "<table><thead><tr><th>번호</th><th>단원</th><th>배점</th><th>난이도</th><th>난이도 근거</th><th>내 답</th><th>정답</th><th>결과</th></tr></thead><tbody>"
  );
  for (const it of items) {
    const r = statusOf(idx, it.label);
    b.push(
      `<tr class="${rowClass(r)}"><td class="c"><b>${esc(it.label)}</b></td><td class="l rpt-small">${esc(it.unit)}</td><td class="c">${fmt(
        it.points
      )}${it.points_assigned ? "*" : ""}</td><td class="c">${badge(it.difficulty)}</td><td class="l rpt-small">${mathHtml(
        katex,
        it.difficulty_reason
      )}</td><td class="c"><code class="v">${esc(givenDisplay(it, idx))}</code></td><td class="c">${mathHtml(
        katex,
        it.answer_display
      )}</td><td class="c ${statusClass(r)}">${statusMark(r)}</td></tr>`
    );
  }
  b.push("</tbody></table>");
  b.push('<p class="rpt-small">* 시험지에 배점이 인쇄되지 않아 합이 100점이 되도록 임의로 배정한 문항입니다. 난이도는 AI가 문제를 풀어 본 뒤 판단한 값이며 실제 정답률이 아닙니다.</p>');

  if (missed.length) {
    b.push('<h2 class="rpt-pagebreak">4. 틀린·무응답 문항 해설</h2>');
    for (const it of missed) {
      const r = statusOf(idx, it.label);
      b.push(
        `<div class="rpt-card"><div class="hd">${esc(it.label)}번 · ${esc(it.unit)} · ${badge(it.difficulty)} · 배점 ${fmt(
          it.points
        )}점</div><div class="st">${mathHtml(katex, it.problem_statement)}</div>` +
          `<div class="row"><span class="rpt-pill mine${r === "blank" ? " blank" : ""}">내 답: <b>${esc(
            givenDisplay(it, idx)
          )}</b>${r === "blank" ? "" : " (오답)"}</span><span class="rpt-pill key">정답: <b>${mathHtml(
            katex,
            it.answer_display
          )}</b></span></div>` +
          `<div class="rpt-sol"><b>풀이</b> — ${mathHtml(katex, it.solution)}</div></div>`
      );
    }
    const easyFirst = rate < 0.5;
    const units: [string, string[]][] = [];
    const sorted = [...missed].sort((a, c) => {
      const da = DIFFS.indexOf(a.difficulty);
      const dc = DIFFS.indexOf(c.difficulty);
      return easyFirst ? da - dc : dc - da;
    });
    for (const it of sorted) {
      const u = it.unit || "단원 미상";
      const found = units.find((x) => x[0] === u);
      if (found) found[1].push(it.label);
      else units.push([u, [it.label]]);
    }
    b.push(
      "<h2>5. 다시 볼 단원</h2>" +
        (easyFirst ? '<p class="rpt-small">쉬운 문항의 단원부터 순서대로 나열했습니다. 위에서부터 차례로 복습하면 점수를 가장 빨리 올릴 수 있습니다.</p>' : "") +
        '<ul class="rpt-cols">'
    );
    for (const [u, labels] of units) b.push(`<li><b>${esc(u)}</b> — ${esc(labels.join(", "))}번</li>`);
    b.push("</ul>");
  } else {
    b.push('<h2 class="rpt-pagebreak">4. 결과</h2>');
    b.push(`<p>${items.length}문항(총 ${fmt(totalPoints)}점)을 모두 맞혔습니다.</p>`);
    const top = items.filter((it) => it.difficulty === "상");
    if (top.length) {
      b.push('<h2>5. 난이도 ‘상’ 문항 풀이 (복습용)</h2><p class="rpt-small">모두 맞힌 문항이라 오답 해설 대신, 난이도를 ‘상’으로 본 문항의 풀이를 실었습니다.</p>');
      for (const it of top) {
        b.push(
          `<div class="rpt-card"><div class="hd">${esc(it.label)}번 · ${esc(it.unit)} · ${badge(it.difficulty)} · 배점 ${fmt(
            it.points
          )}점</div><div class="st">${mathHtml(katex, it.problem_statement)}</div>` +
            `<div class="row"><span class="rpt-pill key">내 답: <b>${esc(givenDisplay(it, idx))}</b> (정답)</span><span class="rpt-pill key">정답: <b>${mathHtml(
              katex,
              it.answer_display
            )}</b></span></div>` +
            `<div class="rpt-sol"><b>풀이</b> — ${mathHtml(katex, it.solution)}</div></div>`
        );
      }
    }
  }
  b.push('<p class="rpt-foot">등급 구분·예상 등급·다른 학생과의 비교는 이 보고서에 포함하지 않았습니다.</p>');

  return `<div class="rpt">${b.join("")}</div>`;
}

// ---------------------------------------------------------------------
// HTML → PDF 렌더링
// ---------------------------------------------------------------------

export async function ensureReportTools(onProgress?: (m: string) => void): Promise<{ katex: any }> {
  onProgress && onProgress("PDF·수식 도구를 불러오는 중…");
  const [katex] = await Promise.all([loadKatex(), loadPdfTools()]);
  injectReportStyles();
  try {
    await document.fonts.load("16px KaTeX_Main");
    await document.fonts.ready;
  } catch {
    // ignore
  }
  return { katex };
}

// ---------------------------------------------------------------------
// 버그 수정(2026-09-28, "보고서가 잘림"): 예전에는 보고서 전체를 html2canvas로 "한 장의 거대한
// 캔버스"로 그린 뒤 A4 높이로 잘라 붙였다. 그래서
//   (1) 보고서가 길면(학생·문항이 많은 종합 보고서 등) 캔버스가 브라우저 최대 크기(높이 약 32,767px —
//       2배 해상도로 A4 15쪽 정도)를 넘어 그 뒤가 통째로 비거나 잘렸고,
//   (2) 쪽 경계가 글줄 한가운데를 지나 글자가 위아래로 반씩 잘렸다(표 줄·카드만 보호되고 있었음).
// 이제는 먼저 A4 한 쪽에 들어가는 만큼씩 블록(제목·표 줄·카드·문단)을 직접 쪽 상자에 나눠 담고
// (긴 표는 줄 단위로 나누며 머리줄을 반복, 긴 덩어리는 안쪽 요소 단위로 나눔, 제목은 다음 내용과 함께),
// 쪽마다 따로 캔버스로 그려 PDF에 붙인다. 한 요소가 혼자서도 한 쪽보다 크면(아주 긴 풀이 한 줄 등)
// 그 쪽만 예전처럼 잘라서 이어 붙인다.
// ---------------------------------------------------------------------

const PAGE_MARGIN_MM = { top: 12, right: 10, bottom: 14, left: 10 };
const CONTENT_W_MM = 210 - PAGE_MARGIN_MM.left - PAGE_MARGIN_MM.right; // 190mm = 보고서 폭 760px
const CONTENT_H_MM = 297 - PAGE_MARGIN_MM.top - PAGE_MARGIN_MM.bottom; // 271mm
const REPORT_W_PX = 760;
const PAGE_H_PX = Math.floor((REPORT_W_PX * CONTENT_H_MM) / CONTENT_W_MM) - 4; // 약 1080px

function meaningfulChildren(el: Element): Node[] {
  return Array.from(el.childNodes).filter(
    (n) => n.nodeType === Node.ELEMENT_NODE || (n.nodeType === Node.TEXT_NODE && (n.textContent || "").trim() !== "")
  );
}

class Paginator {
  pages: HTMLElement[] = [];
  private cur!: HTMLElement;
  private placed = 0; // 이 쪽에 실제로 담은 내용 수(빈 틀 제외)
  private shells = new Map<Element, Element>(); // 원본 컨테이너 → 이 쪽의 빈 틀

  constructor(private stage: HTMLElement, private rootTemplate: HTMLElement) {
    this.newPage();
  }

  private newPage() {
    const p = this.rootTemplate.cloneNode(false) as HTMLElement;
    p.style.width = REPORT_W_PX + "px";
    this.stage.appendChild(p);
    this.pages.push(p);
    this.cur = p;
    this.placed = 0;
    this.shells = new Map();
  }

  private overflow(): boolean {
    return this.cur.scrollHeight > PAGE_H_PX;
  }

  /** 원본 컨테이너 체인에 대응하는 이 쪽의 틀을 (없으면 만들어) 가장 안쪽 담을 곳을 돌려준다. */
  private containerFor(chain: Element[]): Element {
    let parent: Element = this.cur;
    for (const t of chain) {
      let shell = this.shells.get(t);
      if (!shell) {
        shell = t.cloneNode(false) as Element;
        if (t.tagName === "TABLE") {
          for (const c of Array.from(t.children)) {
            if (c.tagName === "COLGROUP" || c.tagName === "THEAD") shell.appendChild(c.cloneNode(true));
          }
          const tb = t.querySelector(":scope > tbody");
          shell.appendChild(tb ? tb.cloneNode(false) : document.createElement("tbody"));
        }
        (parent.tagName === "TABLE" ? parent.querySelector(":scope > tbody")! : parent).appendChild(shell);
        this.shells.set(t, shell);
      }
      parent = shell;
    }
    return parent.tagName === "TABLE" ? parent.querySelector(":scope > tbody")! : parent;
  }

  private breakPage(chain: Element[]) {
    // 맨 위 단계에서 쪽을 넘길 때, 이 쪽 마지막이 제목이면 다음 쪽으로 함께 넘긴다.
    let carry: Element | null = null;
    if (chain.length === 0 && this.placed > 1) {
      const last = this.cur.lastElementChild;
      if (last && /^H[1-3]$/.test(last.tagName)) {
        carry = last;
        this.cur.removeChild(last);
      }
    }
    this.newPage();
    if (carry) {
      this.cur.appendChild(carry);
      this.placed = 1;
    }
  }

  private childrenOf(node: Element): Node[] {
    if (node.tagName === "TABLE") {
      const tb = node.querySelector(":scope > tbody");
      return tb ? Array.from(tb.children) : [];
    }
    return meaningfulChildren(node);
  }

  private splittable(node: Node): node is Element {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const el = node as Element;
    // 표 한 줄·칸, 수식, 작은 배지 등은 절대 쪼개지 않는다.
    if (/^(TR|TD|TH|THEAD|SPAN|B|I|CODE|IMG|SVG)$/.test(el.tagName) || el.classList.contains("katex")) return false;
    return this.childrenOf(el).length > 1;
  }

  place(node: Node, chain: Element[] = []) {
    if (chain.length === 0 && this.placed > 0 && node instanceof Element && node.classList.contains("rpt-pagebreak")) {
      this.breakPage(chain);
    }
    const container = this.containerFor(chain);
    const clone = node.cloneNode(true);
    container.appendChild(clone);
    if (!this.overflow()) {
      this.placed++;
      return;
    }
    container.removeChild(clone);

    // 표·목록은 남은 자리부터 줄 단위로 채운다. 그 밖의 덩어리(카드 등)는 통째로 다음 쪽으로 넘기되,
    // 새 쪽에서도 안 들어가면 안쪽 요소 단위로 나눈다.
    const fillByRows = node instanceof Element && /^(TABLE|UL|OL|TBODY)$/.test(node.tagName);
    if (this.placed > 0 && !(fillByRows && this.splittable(node))) {
      this.breakPage(chain);
      this.place(node, chain);
      return;
    }
    if (this.splittable(node)) {
      for (const child of this.childrenOf(node)) this.place(child, [...chain, node]);
      return;
    }
    // 더 나눌 수 없는데 한 쪽보다 큼 → 그대로 두고(그 쪽만 잘라 붙임) 다음 쪽으로.
    this.containerFor(chain).appendChild(clone);
    this.placed++;
    this.breakPage([]);
  }
}

async function pageToCanvas(el: HTMLElement): Promise<HTMLCanvasElement> {
  const h2c = (window as any).html2canvas;
  return h2c(el, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#ffffff",
    width: REPORT_W_PX,
    windowWidth: REPORT_W_PX + 40,
    scrollX: 0,
    scrollY: 0,
    logging: false,
  });
}

async function renderPagesToPdfBytes(pages: HTMLElement[]): Promise<Uint8Array> {
  const JsPDF = (window as any).jspdf.jsPDF;
  const pdf = new JsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

  let first = true;
  for (const el of pages) {
    const canvas = await pageToCanvas(el);
    const pxPerMm = canvas.width / CONTENT_W_MM;
    const slicePx = Math.floor(CONTENT_H_MM * pxPerMm);
    // 보통은 한 조각(= 한 쪽). 더 나눌 수 없는 요소가 한 쪽보다 큰 경우에만 여러 조각으로 잘린다.
    for (let y = 0; y < canvas.height; y += slicePx) {
      const h = Math.min(slicePx, canvas.height - y);
      if (h < 8 && y > 0) break;
      const part = document.createElement("canvas");
      part.width = canvas.width;
      part.height = h;
      const ctx = part.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, part.width, part.height);
      ctx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
      if (!first) pdf.addPage("a4", "portrait");
      first = false;
      pdf.addImage(part.toDataURL("image/jpeg", 0.95), "JPEG", PAGE_MARGIN_MM.left, PAGE_MARGIN_MM.top, CONTENT_W_MM, h / pxPerMm);
    }
  }

  const nPages = pdf.internal.getNumberOfPages();
  for (let i = 1; i <= nPages; i++) {
    pdf.setPage(i);
    pdf.setFontSize(8);
    pdf.setTextColor(107, 114, 128);
    pdf.text(`${i} / ${nPages}`, 105, 292, { align: "center" });
  }
  const buf: ArrayBuffer = pdf.output("arraybuffer");
  return new Uint8Array(buf);
}

/** html 문자열을 감춰진 DOM에 넣고, A4 쪽 단위로 나눠 PDF 바이트로 만든 뒤 정리한다. */
export async function htmlToPdfBytes(html: string): Promise<Uint8Array> {
  const stageWrap = document.createElement("div");
  // 화면 밖에 두되 레이아웃(높이 측정)은 정상적으로 되도록 크기를 막지 않는다.
  stageWrap.style.cssText = `position:absolute;left:-100000px;top:0;width:${REPORT_W_PX + 40}px;`;
  document.body.appendChild(stageWrap);
  const src = document.createElement("div");
  src.innerHTML = html;
  stageWrap.appendChild(src);
  await new Promise((r) => setTimeout(r, 60));
  try {
    const root = src.firstElementChild as HTMLElement;
    const pager = new Paginator(stageWrap, root);
    for (const child of meaningfulChildren(root)) pager.place(child);
    src.remove();
    const pages = pager.pages.filter((p) => p.childNodes.length > 0);
    return await renderPagesToPdfBytes(pages);
  } finally {
    document.body.removeChild(stageWrap);
  }
}

export function downloadBytes(bytes: Uint8Array, filename: string, mime = "application/pdf"): void {
  const blob = new Blob([bytes as any], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function zipAndDownload(files: { name: string; bytes: Uint8Array }[], zipName: string): Promise<void> {
  const JSZip = await loadJsZip();
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.bytes);
  const blob: Blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = zipName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
