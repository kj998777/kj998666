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
.rpt * { box-sizing: border-box; }
.rpt h1 { font-size: 23px; margin: 0 0 3px; color:#0f2a4a; letter-spacing:-0.3px; }
.rpt h2 { font-size: 16px; margin: 16px 0 6px; color:#0f2a4a; border-left: 4px solid #2563eb; padding-left: 8px; break-after: avoid; page-break-after: avoid; }
.rpt h3 { font-size: 13px; margin: 8px 0 3px; color:#1e3a5f; break-after: avoid; page-break-after: avoid; }
.rpt p { margin: 3px 0; }
.rpt .rpt-sub { color:#52606d; font-size: 12px; margin-bottom: 8px; }
.rpt .rpt-box { border: 1px solid #cbd5e1; background:#f8fafc; border-radius: 6px; padding: 6px 8px; margin: 6px 0; font-size: 11.5px; }
.rpt .rpt-box.warn { border-color:#f59e0b; background:#fffbeb; }
.rpt .rpt-box b { color:#0f2a4a; }
.rpt table { border-collapse: collapse; width: 100%; margin: 4px 0 6px; font-size: 11px; }
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
  const [katex] = await Promise.all([loadKatex(), loadHtml2Pdf()]);
  injectReportStyles();
  try {
    await document.fonts.load("16px KaTeX_Main");
    await document.fonts.ready;
  } catch {
    // ignore
  }
  return { katex };
}

async function renderElementToPdfBytes(el: HTMLElement): Promise<Uint8Array> {
  const html2pdfFn = (window as any).html2pdf;
  const worker = html2pdfFn()
    .set({
      margin: [12, 10, 14, 10],
      html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff", scrollX: 0, scrollY: 0 },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak: { mode: ["css", "legacy"] },
    })
    .from(el)
    .toPdf();
  const pdf = await worker.get("pdf");
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

/** html 문자열을 감춰진 DOM에 넣고 PDF 바이트로 만든 뒤 정리한다. */
export async function htmlToPdfBytes(html: string): Promise<Uint8Array> {
  const stageWrap = document.createElement("div");
  stageWrap.style.cssText = "position:fixed;left:-99999px;top:0;height:0;overflow:hidden";
  document.body.appendChild(stageWrap);
  const el = document.createElement("div");
  el.innerHTML = html;
  stageWrap.appendChild(el);
  await new Promise((r) => setTimeout(r, 60));
  try {
    return await renderElementToPdfBytes(el.firstElementChild as HTMLElement);
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
