// 입학테스트 진단 보고서(0047) — 성적 보고서와 같은 도구(.rpt 양식, A4 쪽 나누기, KaTeX)로 브라우저에서 PDF를 만든다.
// 점수·실질 점수, 추천 수업 단계(참고), 난이도별·단원별 결과, 문항별 결과, 다시 볼 문항(틀린 문항·찍어서 맞힌 문항)의 풀이.
import { badge, esc, mathHtml, MEDIC_BADGE, MEDIC_FOOT } from "@/app/(staff)/exams/[code]/results/buildReportPdf";
import type { BankDetail } from "@/lib/bank/load";
import type { PerItemResult } from "@/lib/grading";
import { diagnose } from "@/lib/placement/pick";

const CIRC: Record<string, string> = { "1": "①", "2": "②", "3": "③", "4": "④", "5": "⑤" };

export type PlacementReportInput = {
  title: string;
  scope: string;
  studentName: string;
  submittedAt: string;
  items: BankDetail[];
  perItem: PerItemResult[];
};

function keyText(katex: any, it: BankDetail): string {
  if (it.answerDisplay && it.answerDisplay.trim()) return mathHtml(katex, it.answerDisplay);
  const alts = String(it.correctAnswers ?? "").split("|").map((x) => x.trim()).filter(Boolean);
  if (!alts.length) return "-";
  if (it.type === "객관식") return esc(alts.map((x) => (/^[1-5]+$/.test(x) ? x.split("").map((c) => CIRC[c]).join("") : x)).join(" 또는 "));
  return alts.map((x) => mathHtml(katex, x)).join(" 또는 ");
}

function givenText(katex: any, it: BankDetail, given: string): string {
  const g = String(given ?? "").trim();
  if (!g) return '<span class="rpt-blk">(빈칸)</span>';
  if (it.type === "객관식" && /^[1-5]+$/.test(g)) return esc(g.split("").map((c) => CIRC[c]).join(""));
  return mathHtml(katex, g);
}

const fmt = (n: number) => String(Math.round(n * 10) / 10);

export function buildPlacementHtml(katex: any, d: PlacementReportInput): string {
  const items = d.items;
  const p = d.perItem ?? [];
  const g = diagnose(
    items.map((it, i) => ({
      label: String(i + 1),
      unit: it.unit,
      area: it.area,
      difficulty: it.difficulty,
      points: it.points,
      correct: !!p[i]?.correct,
      guessed: !!p[i]?.guessed,
    }))
  );
  const total = items.reduce((a, it) => a + (Number(it.points) || 0), 0);
  const okN = p.filter((x) => x?.correct).length;
  const guessedN = p.filter((x) => x?.guessed).length;
  const date = (() => {
    try {
      return new Date(d.submittedAt).toLocaleDateString("ko-KR");
    } catch {
      return "";
    }
  })();
  const b: string[] = [];
  b.push(
    `<div class="rpt-rowh"><div><h1>입학테스트 진단 보고서</h1><div class="rpt-sub" style="margin:0">${esc(d.title)}${
      d.scope ? ` · ${esc(d.scope)}` : ""
    } · ${items.length}문항${date ? ` · ${esc(date)}` : ""}</div></div>${MEDIC_BADGE}</div>`
  );
  b.push(
    `<div class="rpt-big"><div><div class="n" style="font-size:16px">${esc(d.studentName)}</div><div class="t">학생</div></div>` +
      `<div><div class="n">${fmt(g.score)}점</div><div class="t">점수 (${fmt(total)}점 만점)</div></div>` +
      (guessedN > 0 ? `<div><div class="n">${fmt(g.realScore)}점</div><div class="t">실질 점수 (찍어서 맞힌 문항 뺌)</div></div>` : "") +
      `<div><div class="n">${okN} / ${items.length}</div><div class="t">맞힌 문항</div></div>` +
      `<div><div class="n" style="color:#be123c">${g.level}</div><div class="t">추천 수업 단계(참고)</div></div></div>`
  );

  b.push("<h2>1. 종합 의견</h2>");
  const weak = g.weakUnits.slice(0, 4);
  b.push(
    `<p><b>${g.level}</b> 단계 수업을 권합니다. ${esc(g.levelNote)}${
      weak.length ? ` 이번 테스트에서 놓친 단원은 <b>${weak.map(esc).join(", ")}</b>${g.weakUnits.length > weak.length ? " 등" : ""}입니다.` : " 모든 단원을 맞혔습니다."
    }${
      guessedN > 0
        ? ` 확실하지 않아 찍었다고 표시한 문항이 ${guessedN}개 있어, 찍어서 맞힌 문항을 뺀 실질 점수(${fmt(g.realScore)}점)로 판단했습니다.`
        : ""
    }</p>`
  );
  b.push(
    '<div class="rpt-box"><b>단계 기준</b> — 심화: 실질 점수 80점 이상이고 어려운 문항(중상·상)의 절반 이상을 맞힘 · 표준: 실질 점수 50점 이상 · 기초: 그 밖. 문항 수가 적어 참고용입니다.</div>'
  );

  b.push("<h2>2. 난이도별 결과</h2>");
  b.push('<table><thead><tr><th style="width:18%">난이도</th><th style="width:14%">문항</th><th style="width:14%">맞힘</th><th>정답률</th></tr></thead><tbody>');
  for (const r of g.byDiff) {
    const pct = r.n ? Math.round((r.ok / r.n) * 100) : 0;
    b.push(
      `<tr><td class="c">${badge(r.d)}</td><td class="c">${r.n}</td><td class="c">${r.ok}</td><td class="l"><div style="display:flex;align-items:center;gap:6px"><div style="flex:1;height:9px;background:#e5e7eb;border-radius:5px"><div style="width:${pct}%;height:9px;background:#2563eb;border-radius:5px"></div></div><span style="width:34px;text-align:right">${pct}%</span></div></td></tr>`
    );
  }
  b.push("</tbody></table>");

  b.push("<h2>3. 단원별 결과</h2>");
  b.push('<table><thead><tr><th>단원</th><th style="width:14%">문항</th><th style="width:14%">맞힘</th><th style="width:16%">결과</th></tr></thead><tbody>');
  for (const u of g.byUnit) {
    const cls = u.ok === u.n ? "rpt-ok" : u.ok === 0 ? "rpt-bad" : "rpt-blk";
    const word = u.ok === u.n ? "잘함" : u.ok === 0 ? "다시 공부" : "보완";
    b.push(`<tr><td class="l">${esc(u.unit)}</td><td class="c">${u.n}</td><td class="c">${u.ok}</td><td class="c"><span class="${cls}">${word}</span></td></tr>`);
  }
  b.push("</tbody></table>");

  b.push("<h2>4. 문항별 결과</h2>");
  b.push(
    '<table><thead><tr><th style="width:8%">번호</th><th>단원</th><th style="width:12%">난이도</th><th style="width:9%">배점</th><th style="width:17%">학생 답</th><th style="width:17%">정답</th><th style="width:10%">결과</th></tr></thead><tbody>'
  );
  items.forEach((it, i) => {
    const r = p[i];
    const ok = !!r?.correct;
    const blank = !String(r?.given ?? "").trim();
    b.push(
      `<tr class="${ok ? "" : blank ? "rpt-rblk" : "rpt-rbad"}"><td class="c"><b>${i + 1}</b></td><td class="l">${esc(it.unit || it.area || "-")}</td><td class="c">${badge(
        it.difficulty
      )}</td><td class="c">${fmt(it.points)}</td><td class="c">${givenText(katex, it, String(r?.given ?? ""))}</td><td class="c">${keyText(
        katex,
        it
      )}</td><td class="c"><span class="${ok ? "rpt-ok" : blank ? "rpt-blk" : "rpt-bad"}">${ok ? "○" : blank ? "-" : "✕"}</span>${
        r?.guessed ? '<div class="rpt-small">찍음</div>' : ""
      }</td></tr>`
    );
  });
  b.push("</tbody></table>");

  const again = items.map((it, i) => ({ it, i, r: p[i] })).filter((x) => !x.r?.correct || x.r?.guessed);
  if (again.length) {
    b.push('<h2 class="rpt-pagebreak">5. 다시 볼 문항 — 틀린 문항·찍어서 맞힌 문항</h2>');
    for (const { it, i, r } of again) {
      b.push(
        `<div class="rpt-card"><div class="hd">${i + 1}번 · ${badge(it.difficulty)} · ${esc(it.unit || it.area || "")}${
          r?.correct && r?.guessed ? ' <span class="rpt-tag">찍어서 맞힘</span>' : ""
        }</div>` +
          (it.statement && it.statement.trim() ? `<div class="st">${mathHtml(katex, it.statement)}</div>` : "") +
          `<div class="row"><span class="rpt-pill mine${String(r?.given ?? "").trim() ? "" : " blank"}">학생 답: ${givenText(
            katex,
            it,
            String(r?.given ?? "")
          )}</span><span class="rpt-pill key">정답: <b>${keyText(katex, it)}</b></span></div>` +
          (it.solution && it.solution.trim()
            ? `<div class="rpt-sol"><b>풀이</b> — ${mathHtml(katex, it.solution)}</div>`
            : '<div class="rpt-sol rpt-small">아직 등록된 풀이가 없습니다.</div>') +
          "</div>"
      );
    }
  }
  b.push(
    '<p class="rpt-foot">난이도·단원은 AI가 문제를 풀어 보고 붙인 값입니다. 문제 글은 원래 시험지를 요약·정리한 것이라 그림·표는 시험지를 함께 보세요.</p>'
  );
  b.push(MEDIC_FOOT);
  return `<div class="rpt">${b.join("")}</div>`;
}
