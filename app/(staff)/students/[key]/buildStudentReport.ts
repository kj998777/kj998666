// 학생 누적 성적 보고서 PDF(학부모 상담용, 2026-09-30). 시험별 성적 보고서와 같은 도구(html2canvas + jsPDF,
// A4 쪽 나누기)와 같은 모양(.rpt)을 쓴다 — app/(staff)/exams/[code]/results/buildReportPdf.ts.
// 계산은 서버에서 끝난 Analysis(lib/students/analysis.ts)를 그대로 받아 그리기만 한다.
import { badge, brandHead, downloadBytes, ensureReportTools, esc, htmlToPdfBytes, mathHtml } from "@/app/(staff)/exams/[code]/results/buildReportPdf";
import { reconcileKeyDisplay } from "@/lib/review/answerMatch";
import { trendSvg, type Analysis, type Attempt, type Bucket } from "@/lib/students/analysis";
import { promoReportHtml } from "@/lib/content/promo";

export type StudentReportInput = {
  name: string;
  classText: string;
  analysis: Analysis;
  memo: string;
  opts: { classAvg: boolean; review: boolean };
};

const CIRC: Record<string, string> = { "1": "①", "2": "②", "3": "③", "4": "④", "5": "⑤" };

function pct(r: number | null | undefined): string {
  return r == null ? "-" : `${Math.round(r * 100)}%`;
}
function fmt(n: number): string {
  return String(Math.round((n + 1e-9) * 100) / 100);
}
function day(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

/** SVG 문자열 → PNG data URL(html2canvas가 SVG를 불안정하게 그려서 그림으로 바꿔 넣는다) */
async function svgToPng(svg: string, w: number, h: number): Promise<string> {
  const img = new Image();
  const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("그래프를 그리지 못했습니다."));
    img.src = url;
  });
  const c = document.createElement("canvas");
  c.width = w * 2;
  c.height = h * 2;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/png");
}

function bar(rate: number): string {
  const w = Math.round(Math.max(0, Math.min(1, rate)) * 100);
  const color = rate >= 0.8 ? "#1C1A16" : rate >= 0.6 ? "#8A8178" : "#A83232"; // 학원 색(먹색·회색·십자 빨강)
  return `<div style="height:10px;background:#EDE9E2;border-radius:2px;overflow:hidden"><div style="height:10px;width:${w}%;background:${color}"></div></div>`;
}

function bucketTable(title: string, rows: Bucket[]): string {
  if (!rows.length) return "";
  const b: string[] = [];
  b.push(
    `<table><colgroup><col style="width:30%"><col style="width:16%"><col style="width:12%"><col style="width:42%"></colgroup><thead><tr><th>${esc(
      title
    )}</th><th>맞힌 문항 / 출제</th><th>정답률</th><th></th></tr></thead><tbody>`
  );
  for (const r of rows) b.push(`<tr><td class="l"><b>${esc(r.name)}</b></td><td class="c">${r.ok} / ${r.n}</td><td class="c">${pct(r.rate)}</td><td>${bar(r.rate)}</td></tr>`);
  b.push("</tbody></table>");
  return b.join("");
}

function givenText(a: Attempt): string {
  if (a.blank || !a.given.trim()) return "무응답";
  if (a.item.type === "객관식" && CIRC[a.given]) return CIRC[a.given];
  return a.given;
}

function keyText(katex: any, a: Attempt): string {
  // 2026-10-03: 정답 표시가 정답표와 다르면 채점 기준인 정답표를 보여 준다(lib/review/answerMatch.ts).
  const { text } = reconcileKeyDisplay(a.item.type, a.item.correct_answers, a.item.answer_display);
  if (!text) return "-";
  if (a.item.type === "객관식" && /^[①②③④⑤ 또는]+$/.test(text)) return esc(text);
  return text
    .split(" 또는 ")
    .map((x) => mathHtml(katex, x))
    .join(" 또는 ");
}

export function buildStudentReportHtml(katex: any, input: StudentReportInput, chartPng: string | null): string {
  const a = input.analysis;
  const exams = a.exams;
  const b: string[] = [];
  const period = exams.length ? `${day(exams[0].submittedAt)} ~ ${day(exams[exams.length - 1].submittedAt)}` : "";
  b.push(
    `<div class="rpt-rowh"><div><h1>누적 성적 보고서</h1><div class="rpt-sub" style="margin:0">${esc(input.name)} · ${esc(input.classText)}${
      period ? ` · ${esc(period)}` : ""
    }</div></div>${brandHead(`발행 ${esc(day(new Date().toISOString()))} · 메딕수학`)}</div>`
  );
  const t = a.trend;
  const trendText =
    t.direction === "up" ? "오름" : t.direction === "down" ? "내림" : t.direction === "flat" ? "비슷" : "-";
  const slope = t.slopePerExam != null ? `${t.slopePerExam >= 0 ? "+" : ""}${Math.round(t.slopePerExam * 100)}%p / 회` : "시험 2회부터";
  b.push(
    `<div class="rpt-big"><div><div class="n">${exams.length}회</div><div class="t">본 시험</div></div><div><div class="n">${pct(
      a.avgRate
    )}</div><div class="t">평균 득점률</div></div><div><div class="n">${pct(a.lastRate)}</div><div class="t">최근 시험 득점률</div></div><div><div class="n">${trendText}</div><div class="t">추이 (${esc(
      slope
    )})</div></div><div><div class="n">${a.okItems} / ${a.totalItems}</div><div class="t">맞힌 문항 / 전체</div></div></div>`
  );

  b.push("<h2>1. 종합 의견</h2>");
  b.push(`<ul>${a.advice.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>`);
  if (input.memo.trim()) b.push(`<div class="rpt-box"><b>선생님 의견</b><br>${esc(input.memo.trim()).replace(/\n/g, "<br>")}</div>`);

  b.push("<h2>2. 시험별 점수 추이</h2>");
  if (chartPng && exams.length) {
    b.push(`<div style="text-align:center"><img src="${chartPng}" style="width:680px;height:230px"></div>`);
    b.push(
      `<p class="rpt-small" style="text-align:center">파란 선: 득점률(%)${input.opts.classAvg && exams.some((e) => e.classAvg != null) ? " · 회색 점선: 같은 반 평균" : ""}</p>`
    );
  }
  const showAvg = input.opts.classAvg;
  b.push(
    `<table><thead><tr><th style="width:${showAvg ? 27 : 34}%">시험</th><th>날짜</th><th>반</th><th>점수 / 만점</th><th>득점률</th><th style="width:17%">정답·오답·무응답</th>${
      showAvg ? "<th>반 평균</th>" : ""
    }</tr></thead><tbody>`
  );
  for (const e of exams) {
    b.push(
      `<tr><td class="l">${esc(e.name)}</td><td class="c">${esc(day(e.submittedAt))}</td><td class="c rpt-small">${esc(e.classLabel)}</td><td class="c">${fmt(e.score)} / ${fmt(
        e.max
      )}${e.guessed > 0 ? `<div class="rpt-small">실질 ${fmt(e.realScore)} (찍음 ${e.guessed}개 중 ${e.guessedCorrect}개 맞음)</div>` : ""}</td><td class="c"><b>${pct(e.rate)}</b></td><td class="c">${e.correct} · ${e.wrong} · ${e.blank}</td>${
        showAvg ? `<td class="c">${e.classAvg != null ? `${pct(e.classAvg)} (${e.classCount}명)` : "-"}</td>` : ""
      }</tr>`
    );
  }
  b.push("</tbody></table>");

  b.push("<h2>3. 영역·난이도별 정답률</h2>");
  b.push(bucketTable("영역", a.areas));
  if (a.diffs.length) {
    b.push(
      "<table><thead><tr><th>난이도</th>" +
        a.diffs.map((d) => `<th>${badge(d.name)}</th>`).join("") +
        "</tr></thead><tbody><tr><td class=\"c\">맞힌 문항 / 출제</td>" +
        a.diffs.map((d) => `<td class="c">${d.ok} / ${d.n}<br><span class="rpt-small">${pct(d.rate)}</span></td>`).join("") +
        "</tr></tbody></table>"
    );
  }
  if (a.types.length > 1)
    b.push(`<p class="rpt-small">${a.types.map((x) => `${esc(x.name)} ${x.ok}/${x.n} (${pct(x.rate)})`).join(" · ")} · 무응답 ${pct(a.blankRate)}</p>`);
  if (a.areaChanges.some((c) => Math.abs(c.delta) >= 0.2)) {
    b.push("<h3>앞 시험들과 비교한 영역별 변화</h3><ul>");
    for (const c of a.areaChanges.filter((x) => Math.abs(x.delta) >= 0.2).slice(0, 5))
      b.push(`<li><b>${esc(c.name)}</b> ${pct(c.before)} → ${pct(c.after)} (${c.delta > 0 ? "좋아짐" : "떨어짐"})</li>`);
    b.push("</ul>");
  }

  b.push("<h2>4. 우선 복습할 단원</h2>");
  if (a.weakUnits.length) {
    const nameOf = new Map(exams.map((e) => [e.examId, e.name]));
    b.push("<table><thead><tr><th style=\"width:28%\">단원</th><th style=\"width:14%\">맞힌 / 출제</th><th>나온 문항(× 틀림 · ○ 맞음)</th></tr></thead><tbody>");
    for (const u of a.weakUnits) {
      const refs = u.refs.map((r) => `${esc(nameOf.get(r.examId) ?? "")} ${esc(r.label)}번 ${r.ok ? "○" : "×"}`).join(", ");
      b.push(`<tr><td class="l"><b>${esc(u.name)}</b></td><td class="c">${u.ok} / ${u.n}</td><td class="l rpt-small">${refs}</td></tr>`);
    }
    b.push("</tbody></table>");
  } else b.push("<p>두 번 이상 나온 단원 중 눈에 띄게 약한 단원은 없습니다.</p>");

  if (input.opts.review && a.review.length) {
    b.push('<h2 class="rpt-pagebreak">5. 다시 풀어 볼 문항</h2>');
    b.push('<p class="rpt-small">약한 단원에서 틀린 문항, 쉬운데 놓친 문항 순으로 골랐습니다(최대 10문항).</p>');
    for (const r of a.review) {
      b.push(
        `<div class="rpt-card"><div class="hd">${esc(r.examName)} · ${esc(r.item.label)}번 · ${esc(r.item.unit || "단원 미상")} · ${badge(
          r.item.difficulty
        )}</div><div class="st">${mathHtml(katex, r.item.problem_statement || "")}</div><div class="row"><span class="rpt-pill mine${
          r.blank ? " blank" : ""
        }">내 답: <b>${esc(givenText(r))}</b></span><span class="rpt-pill key">정답: <b>${keyText(katex, r)}</b></span></div>${
          r.item.solution ? `<div class="rpt-sol"><b>풀이</b> — ${mathHtml(katex, r.item.solution)}</div>` : ""
        }</div>`
      );
    }
  }
  b.push(
    '<p class="rpt-foot">득점률 = 받은 점수 ÷ 만점. 영역·단원·난이도는 AI가 문제를 풀며 붙인 값이라 학교마다 이름이 조금 다를 수 있습니다. 등급 구분·예상 등급은 포함하지 않습니다.</p>'
  );
  b.push(promoReportHtml()); // 2026-10-01: 학원 학생 누적 보고서(학부모 상담용) 끝에 메딕수학 홍보 상자
  return `<div class="rpt">${b.join("")}</div>`;
}

export async function downloadStudentReport(input: StudentReportInput, onProgress?: (m: string) => void): Promise<void> {
  const { katex } = await ensureReportTools(onProgress);
  onProgress && onProgress("그래프를 그리는 중…");
  let chart: string | null = null;
  try {
    const ex = input.analysis.exams.map((e) => ({ ...e, classAvg: input.opts.classAvg ? e.classAvg : null }));
    if (ex.length) chart = await svgToPng(trendSvg(ex), 680, 230);
  } catch {
    chart = null;
  }
  onProgress && onProgress("PDF로 만드는 중…");
  const bytes = await htmlToPdfBytes(buildStudentReportHtml(katex, input, chart));
  const safe = input.name.replace(/[\\/:*?"<>|\s]+/g, "_");
  downloadBytes(bytes, `누적성적_${safe}_${day(new Date().toISOString()).replace(/\./g, "")}.pdf`);
}
