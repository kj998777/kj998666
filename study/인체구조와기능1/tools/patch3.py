"""Study-efficiency features: shuffled options, '오늘 복습' spaced-review mode, D-day plan panel."""
import sys

src, out = sys.argv[1:3]
h = open(src, encoding='utf-8').read()


def rep(old, new, count=1):
    global h
    assert h.count(old) >= 1, old[:80]
    h = h.replace(old, new, count)


# ---- 1) shuffled options for prediction MCQs ----
rep("const base = S.list[S.i], q = eff(base), box = $('#quiz');",
    "const base = S.list[S.i], q = mixQ(base, eff(base)), box = $('#quiz');")

# ---- 2) '오늘 복습' mode ----
rep('<button data-mode="review">틀림·모름만</button>',
    '<button data-mode="review">틀림·모름만</button>\n          <button data-mode="due">오늘 복습</button>')
rep("  if (mode === 'review') pool = pool.filter(q => P[q.id] && P[q.id].r !== 1);",
    "  if (mode === 'review') pool = pool.filter(q => P[q.id] && P[q.id].r !== 1);\n"
    "  if (mode === 'due') pool = pool.filter(isDue).sort((a, b) => dueScore(b) - dueScore(a));")
rep("(prefs.mode === 'unsolved' || prefs.mode === 'review' ? ` → 이 모드로 ${n}문항`",
    "(prefs.mode === 'unsolved' || prefs.mode === 'review' || prefs.mode === 'due' ? ` → 이 모드로 ${n}문항`")

# ---- 3) plan panel + shuffle toggle ----
rep('    <div id="pickView">\n      <div id="regions"></div>',
    '    <div id="pickView">\n      <div id="planBox"></div>\n      <div id="regions"></div>')
rep("  renderRegions();\n  const tab = currentTab();", "  renderRegions();\n  renderPlan();\n  const tab = currentTab();")

css = """
.plan{padding:14px 16px;margin-bottom:12px}
.plan .dd{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.plan .dd b{font-size:22px;color:var(--accent)}
.plan .today{margin:10px 0 4px;display:grid;gap:8px}
.plan .task{display:flex;gap:10px;align-items:center;border:1px solid var(--line);border-radius:10px;padding:9px 11px;background:var(--surface)}
.plan .task .tt{flex:1;min-width:0;font-size:14px;line-height:1.5}
.plan .task .tt small{display:block;color:var(--ink3);font-size:12px}
.plan details{margin-top:8px}
.plan summary{cursor:pointer;color:var(--ink2);font-size:13px}
.plan table{width:100%;border-collapse:collapse;font-size:13px;margin-top:6px}
.plan td{border-top:1px solid var(--line);padding:6px 4px;vertical-align:top}
.plan td:first-child{white-space:nowrap;color:var(--ink2);width:72px}
.plan tr.past td{color:var(--ink3)}
.plan tr.now td{background:var(--accent-soft)}
.plan .opts{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:center}
"""
rep('</style>', css + '</style>')

js = r"""
/* ---- study plan, spaced review, shuffled options ---- */
const EXAM = {date: '2026-10-28', label: '10/28(수) 중간고사'};
const ALLP = ['K1','K2','K3','K4','K5','K6','K7','J1','J2','J3','J4','Y1','Y2','Y3','Y4','Y5'];
const PLAN = [
  ['2026-10-08', '배벽 강의(윤상필) 날', [['윤상필p 총론·배벽·샅굴 1회독', ['Y1','Y2'], 'order']]],
  ['2026-10-09', '김진우p 학생발표 원문', [['학생발표 문제 원문 1회독 — 교수님이 그대로 낼 수 있는 문제', ['J1'], 'order']]],
  ['2026-10-10', '김진우p 변형·상지', [['학생발표 변형 + 상지 조합형', ['J2','J3'], 'order']]],
  ['2026-10-11', '김진우p 총론·등 + 실습', [['총론·등 + 실습·임상(카데바) 시나리오', ['J4','K6'], 'order']]],
  ['2026-10-12', '김정태p 1', [['골학 + 넙다리·볼기', ['K1','K2'], 'order']]],
  ['2026-10-13', '김정태p 2', [['종아리·발 + 다리의 관절', ['K3','K4'], 'order']]],
  ['2026-10-14', '창자 강의(윤상필) 날', [['강의 들은 날 저녁: 복막·창자', ['Y3'], 'order'], ['김정태p 가슴우리·가슴벽', ['K5'], 'order']]],
  ['2026-10-15', '소화기 부속샘 강의(윤상필) 날', [['강의 들은 날 저녁: 간·쓸개·이자·지라', ['Y4'], 'order'], ['김정태p 심장·허파·가슴막·젖', ['K7'], 'order']]],
  ['2026-10-16', '1회독 마무리', [['윤상필p 혈관·신경·임상 연계', ['Y5'], 'order'], ['오늘 복습 (틀린 지 하루 지난 문제)', ALLP, 'due']]],
  ['2026-10-17', '김진우p 2회독', [['김진우p 틀림·모름만 → 📄 PDF로 묶어 형광펜 문장 읽기', ['J1','J2','J3','J4'], 'review']]],
  ['2026-10-18', '김정태p 2회독', [['김정태p 틀림·모름만 → PDF 묶기', ['K1','K2','K3','K4','K5','K6','K7'], 'review']]],
  ['2026-10-19', '윤상필p 2회독', [['윤상필p 틀림·모름만 → PDF 묶기', ['Y1','Y2','Y3','Y4','Y5'], 'review']]],
  ['2026-10-20', 'CBL 날 · 족보', [['오늘 복습', ALLP, 'due'], ['「범위 고르기」 탭에서 JB 족보 한 바퀴', null, null]]],
  ['2026-10-21', '골반벽 강의(김진우) 날', [['예상문제 없음 — 강의 직후 길라잡이 골반벽 부분 정독', null, null], ['오늘 복습', ALLP, 'due']]],
  ['2026-10-22', '여성 생식기관 강의(김진우) 날', [['예상문제 없음 — 강의 직후 길라잡이 여성 생식기관 정독', null, null], ['오늘 복습', ALLP, 'due']]],
  ['2026-10-23', '섞어 풀기', [['전 범위 무작위 — 단원을 섞어야 진짜 실력이 보여요', ALLP, 'random']]],
  ['2026-10-24', '약점 집중', [['틀린 횟수 2회 이상만', ALLP, 'wcount', 2]]],
  ['2026-10-25', '김진우p 비중 최대', [['학생발표 원문·변형 최종 점검', ['J1','J2'], 'order'], ['오늘 복습', ALLP, 'due']]],
  ['2026-10-26', '모의고사', [['전 범위 무작위 한 번 더 + 오늘 복습', ALLP, 'random']]],
  ['2026-10-27', '남성 생식기관 강의(김진우) 날', [['강의 직후 길라잡이 남성 생식기관 정독', null, null], ['틀린 횟수 2회 이상 → PDF 형광펜 문장만 훑기', ALLP, 'wcount', 2]]],
  ['2026-10-28', '시험 날', [['아침: 틀린 횟수 2회 이상의 형광펜 문장만. 새 문제는 풀지 않기', ALLP, 'wcount', 2]]],
];
function ymd(d){ return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function dayDiff(a, b){ return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5); }
const WD = '일월화수목금토';
function dlabel(s){ const d = new Date(s + 'T00:00:00'); return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`; }

/* spaced review: wrong/unknown → again the next day; right → wait longer the fewer times it was missed */
function isDue(q){
  const p = P[q.id]; if (!p || !p.t) return false;
  const age = (Date.now() - p.t) / 864e5, miss = (p.w || 0) + (p.u || 0);
  if (p.r !== 1) return age >= 0.6;
  return age >= (miss >= 2 ? 3 : miss === 1 ? 6 : 12);
}
function dueScore(q){ const p = P[q.id]; return ((p.w || 0) + (p.u || 0)) * 2 + (p.r !== 1 ? 5 : 0) + (Date.now() - p.t) / 864e5 / 7; }

function runPlanTask(subs, mode, wmin){
  if (currentTab() !== 'pred') { const b = document.querySelector('#tabs [data-tab=pred]'); if (b) b.click(); }
  sel.clear(); subs.forEach(s => sel.add(s)); saveSel();
  prefs.mode = mode; if (wmin) prefs.wmin = wmin; lsSet(LS_KEY, snapshot());
  renderHome();
  const n = poolFor(mode).length;
  if (!n) { $('#selinfo').textContent = mode === 'due' ? '오늘 복습할 문제가 없어요 — 아직 푼 문제가 적거나 다 맞혔어요.' : '이 조건에 맞는 문제가 없어요.'; return; }
  $('#startBtn').click();
}
function renderPlan(){
  const box = $('#planBox'); if (!box) return;
  if (currentTab() !== 'pred') { box.replaceChildren(); return; }
  const today = ymd(new Date()), dd = dayDiff(today, EXAM.date);
  const row = PLAN.find(r => r[0] === today);
  const dueN = PQ.filter(isDue).length;
  const taskEl = ([txt, subs, mode, wmin]) => el('div', {class:'task'},
    el('div', {class:'tt'}, txt, subs ? el('small', null, mode === 'due' ? `지금 ${PQ.filter(q => subs.includes(q.c) && isDue(q)).length}문항` : `${subs.length === ALLP.length ? '전 범위' : subs.map(s => SUBS[s] || s).join(' · ')} · ${({order:'순서대로', random:'무작위', review:'틀림·모름만', due:'오늘 복습', wcount:'틀린 횟수 ' + (wmin || 1) + '회 이상'})[mode]}`) : null),
    subs ? el('button', {class:'btn sm primary', onclick: () => runPlanTask(subs, mode, wmin)}, '시작') : null);
  const mixBtn = el('button', {class:'btn sm' + (prefs.mix === false ? '' : ' on'), onclick: () => { prefs.mix = prefs.mix === false; lsSet(LS_KEY, snapshot()); renderPlan(); }},
    prefs.mix === false ? '🔀 보기 섞기 꺼짐' : '🔀 보기 섞기 켜짐');
  box.replaceChildren(el('div', {class:'panel plan'},
    el('div', {class:'dd'}, el('b', null, dd > 0 ? `D-${dd}` : dd === 0 ? 'D-DAY' : '시험 끝'), el('span', null, EXAM.label + ' · 세 교수님 모두 5지선다'),
      el('span', {class:'chip', text:`오늘 복습 대기 ${dueN}문항`})),
    row ? el('div', {class:'today'}, el('div', {style:'font-size:13px;color:var(--ink2)', text:`오늘 ${dlabel(today)} — ${row[1]}`}), ...row[2].map(taskEl))
        : el('div', {class:'today'}, dd > 0 ? taskEl(['오늘 복습', ALLP, 'due']) : el('div', {class:'note', text:'일정표 기간이 아니에요.'})),
    el('div', {class:'opts'}, mixBtn, el('span', {class:'note', style:'margin:0', text:'예상문제 보기 순서를 풀 때마다 섞어요 (해설에 원래 번호 표시)'})),
    el('details', null, el('summary', null, '전체 일정 보기 (교수계획서 기준)'),
      el('table', null, PLAN.map(r => el('tr', {class: r[0] < today ? 'past' : r[0] === today ? 'now' : ''},
        el('td', null, dlabel(r[0])), el('td', null, el('b', null, r[1]), el('br'), r[2].map(t => t[0]).join(' / '))))))));
}

/* options shuffled per session; the explanation keeps the original numbering, so say how they map */
function mixQ(base, q){
  if (base.set !== 'p' || q.t !== 'mcq' || prefs.mix === false || !q.tx) return q;
  const tx = q.tx, i0 = tx.indexOf('①');
  if (i0 < 0) return q;
  const head = tx.slice(0, i0), rest = tx.slice(i0);
  const marks = [...rest.matchAll(/[①②③④⑤]/g)];
  if (marks.length !== 5 || marks.map(m => m[0]).join('') !== '①②③④⑤') return q;
  const opts = []; let tail = '', multi = false;
  for (let k = 0; k < 5; k++) {
    const seg = rest.slice(marks[k].index + 1, k < 4 ? marks[k + 1].index : undefined);
    const nl = seg.indexOf('\n');
    if (k < 4) { if (nl >= 0) { if (seg.slice(nl).trim()) return q; multi = true; opts.push(seg.slice(0, nl).trim()); } else opts.push(seg.trim()); }
    else { if (nl >= 0) { tail = seg.slice(nl); opts.push(seg.slice(0, nl).trim()); } else opts.push(seg.trim()); }
  }
  S.mix = S.mix || {};
  let perm = S.mix[base.id];
  if (!perm) { perm = shuffle([0, 1, 2, 3, 4]); S.mix[base.id] = perm; }
  const ans = q.a[0] - 1, now = perm.indexOf(ans);
  const body = perm.map((o, j) => CIRC[j] + ' ' + opts[o]).join(multi ? '\n' : ' ');
  const map = perm.map((o, j) => `${CIRC[j]}=원래 ${CIRC[o]}`).join(', ');
  return Object.assign({}, q, {tx: head + body + tail, a: [now + 1], d: CIRC[now],
    x: `🔀 보기 순서를 섞었어요. 아래 해설의 번호는 원래 번호예요 — 지금 ${map}\n\n` + (q.x || '')});
}
"""
rep('/* boot */', js + '\n/* boot */')
open(out, 'w', encoding='utf-8').write(h)
print('ok', len(h))
