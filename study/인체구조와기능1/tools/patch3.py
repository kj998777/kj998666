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

# ---- 4) 추가 공부: pick which questions go into the PDF ----
rep("      el('button', {class:'btn sm', onclick: () => openPdfMaker(list, '추가 공부')}, '📄 PDF로 묶기'),",
    "      el('button', {class:'btn sm', onclick: () => { STUDYSEL.size === list.length ? STUDYSEL.clear() : list.forEach(q => STUDYSEL.add(q.id)); renderStudy(); }}, STUDYSEL.size === list.length ? '선택 해제' : '전체 선택'),\n"
    "      el('button', {class:'btn sm' + (STUDYSEL.size ? ' primary' : ''), disabled: !STUDYSEL.size, title: STUDYSEL.size ? '' : '아래 목록 왼쪽 네모를 눌러 PDF에 넣을 문제를 고르세요', onclick: () => openPdfMaker(list.filter(q => STUDYSEL.has(q.id)), `추가 공부 ${STUDYSEL.size}문제`)}, STUDYSEL.size ? `📄 선택 ${STUDYSEL.size}문제 PDF로 묶기` : '📄 PDF로 묶기 (문제 선택)'),")
rep("  let list = Q.filter(q => inStudy(q.id));\n  if (studyOrder === 'added')",
    "  let list = Q.filter(q => inStudy(q.id));\n  for (const id of [...STUDYSEL]) if (!inStudy(id)) STUDYSEL.delete(id);\n  if (studyOrder === 'added')")
rep("'를 누르면 해설이 근거로 든 교재·PPT 쪽을 한 파일로 모아 줘요.'));\n  if (!list.length) { box.append(el('div', {class:'panel empty', text:'아직 추가 공부로 보낸 문제가 없어요.'})); return; }",
    "'는 왼쪽 네모로 고른 문제만 해설이 근거로 든 교재·PPT 쪽을 한 파일로 모아 줘요.'));\n  if (!list.length) { box.append(el('div', {class:'panel empty', text:'아직 추가 공부로 보낸 문제가 없어요.'})); return; }")
rep("    ul.append(el('li', {onclick: () => startSession(list, '추가 공부', i, {openExp: true})},\n      el('span', {class:'chip', text:q.c}),",
    "    ul.append(el('li', {onclick: () => startSession(list, '추가 공부', i, {openExp: true})},\n"
    "      el('span', {class:'chk' + (STUDYSEL.has(q.id) ? ' on' : ''), role:'checkbox', 'aria-checked': String(STUDYSEL.has(q.id)), title:'PDF에 넣기', style:'cursor:pointer;flex:none', onclick: ev => { ev.stopPropagation(); STUDYSEL.has(q.id) ? STUDYSEL.delete(q.id) : STUDYSEL.add(q.id); renderStudy(); }}),\n"
    "      el('span', {class:'chip', text:q.c}),")

# ---- 5) 주제별 폴더 (복습 노트·추가 공부) ----
rep("[['added', '최근 추가순'], ['wrong', '많이 틀린 순'], ['range', '단원순']]",
    "[['folder', '📁 주제별 폴더'], ['added', '최근 추가순'], ['wrong', '많이 틀린 순'], ['range', '단원순']]")
rep("let studyOrder = 'added';", "let studyOrder = 'folder';")
rep("  else if (studyOrder === 'wrong') list.sort((a, b) => wrongN(b.id) - wrongN(a.id));",
    "  else if (studyOrder === 'wrong') list.sort((a, b) => wrongN(b.id) - wrongN(a.id));\n"
    "  else if (studyOrder === 'folder') list = sortByFolder(list, (a, b) => ST[b.id].t - ST[a.id].t);")
rep("      countChips(q.id),\n      el('button', {class:'btn sm ghost', title:'추가 공부에서 빼기', onclick: ev => { ev.stopPropagation(); setStudy(q.id, false); renderStudy(); renderStats(); }}, '✓ 공부 끝')));\n  });\n  box.append(ul);",
    "      countChips(q.id),\n      el('button', {class:'btn sm ghost', title:'추가 공부에서 빼기', onclick: ev => { ev.stopPropagation(); setStudy(q.id, false); renderStudy(); renderStats(); }}, '✓ 공부 끝')));\n  });\n"
    "  box.append(studyOrder === 'folder' ? foldUp(list, [...ul.children], '추가 공부', {pick: true, redraw: renderStudy}) : ul);")
# review (latest results view)
rep("  if (!list.length) { box.append(el('div', {class:'panel empty', text:'해당하는 문제가 없어요.'})); return; }\n  box.append(qList(list, '복습 노트'));",
    "  if (!list.length) { box.append(el('div', {class:'panel empty', text:'해당하는 문제가 없어요.'})); return; }\n"
    "  box.append(el('div', {class:'seg', style:'margin:0 0 8px'}, [['fold', '📁 주제별 폴더'], ['flat', '목록']].map(([k, lab]) =>\n"
    "    el('button', {class: (prefs.rfold === false ? 'flat' : 'fold') === k ? 'on' : '', onclick: () => { prefs.rfold = k === 'fold'; lsSet(LS_KEY, snapshot()); renderReview(); }}, lab))));\n"
    "  if (prefs.rfold === false) box.append(qList(list, '복습 노트'));\n"
    "  else { const fl = sortByFolder(list, (a, b) => P[b.id].t - P[a.id].t); box.append(foldUp(fl, [...qList(fl, '복습 노트').children], '복습 노트')); }")
rep("    box.append(qList(list, `틀린 횟수 ${prefs.wmin}회 이상`));\n    return;",
    "    if (prefs.rfold === false) box.append(qList(list, `틀린 횟수 ${prefs.wmin}회 이상`));\n"
    "    else { const fl = sortByFolder(list, (a, b) => wrongN(b.id) - wrongN(a.id)); box.append(foldUp(fl, [...qList(fl, `틀린 횟수 ${prefs.wmin}회 이상`).children], `틀린 횟수 ${prefs.wmin}회 이상`)); }\n    return;")
css2 = """
.fold{margin-bottom:8px;padding:0;overflow:hidden}
.fold>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:8px;padding:11px 12px;flex-wrap:wrap}
.fold>summary::-webkit-details-marker{display:none}
.fold>summary .fn{flex:1;min-width:0;font-weight:600;font-size:14.5px}
.fold>summary .fn small{display:block;font-weight:400;color:var(--ink3);font-size:12px}
.fold>summary .ar{transition:transform .15s;color:var(--ink3)}
.fold[open]>summary .ar{transform:rotate(90deg)}
.fold>ul{margin:0;border:0;border-top:1px solid var(--line);border-radius:0;box-shadow:none}
"""
rep('</style>', css2 + '</style>')

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
const STUDYSEL = new Set();   // 추가 공부 items picked for the PDF

/* ---- 2026 교수님 범위로 옛 족보(JB) 모으기 ---- */
const PROF = [
  {n:'김진우p', w:'약 45~50%', what:'등, 어깨·위팔, 겨드랑, 아래팔, 손, 팔의 관절, 골반벽, 생식기관', jb:['B1','B2','C1','C2','C3','C4','C5','C6','C7','G1','G2','G3'], maybe:['B3','G4'], p:['J1','J2','J3','J4']},
  {n:'김정태p', w:'약 30%', what:'넙다리·볼기, 다리·발, 다리의 관절, 가슴우리·세로칸, 심장·허파', jb:['D1','D2','D3','D4','D5','D6','E1','E2','E3','E4'], maybe:[], p:['K1','K2','K3','K4','K5','K6','K7']},
  {n:'윤상필p', w:'약 20%', what:'총론, 배벽, 창자, 소화기 부속샘', jb:['A1','A2','A3','F1','F2','F3','F4','F6'], maybe:['F5'], p:['Y1','Y2','Y3','Y4','Y5']},
];
const MAYBE_NOTE = {B3:'척수 겉모양·척수신경 — 척수는 기말(윤상필) 범위, 등 강의에서 척수신경만 다룰 수 있음', G4:'방광·곧창자·회음 — 계획서 중간 범위에 따로 없음(골반벽 강의에 일부 포함 가능)', F5:'콩팥·부신·뒤배벽 — 계획서에 콩팥 강의 없음(뒤배벽만 배벽 강의에 포함 가능)'};
function profSubs(pf){ return pf.jb.concat(prefs.pmaybe ? pf.maybe : []); }
function profOff(pf){ prefs.poff = prefs.poff || {}; return new Set(prefs.poff[pf.n] || []); }
function setProfOff(pf, off){ prefs.poff = prefs.poff || {}; prefs.poff[pf.n] = [...off]; lsSet(LS_KEY, snapshot()); renderPlan(); }
const PMODES = [['all', '전체'], ['unsolved', '안 푼 것'], ['review', '틀림·모름'], ['due', '오늘 복습'], ['random', '무작위']];
function profPool(list){
  const m = prefs.pmode || 'all';
  if (m === 'unsolved') return list.filter(q => !P[q.id] && eff(q).t !== 'none');
  if (m === 'review') return list.filter(q => P[q.id] && P[q.id].r !== 1);
  if (m === 'due') return list.filter(isDue);
  if (m === 'random') return shuffle(list.slice());
  return list;
}
function renderProfBox(box){
  const cards = PROF.map(pf => {
    const off = profOff(pf);
    const jsubs = profSubs(pf), psubs = pf.p;
    const onJ = jsubs.filter(s => !off.has(s)), onP = psubs.filter(s => !off.has(s));
    const jq = profPool(JBQ.filter(q => onJ.includes(q.c))), pq = profPool(PQ.filter(q => onP.includes(q.c)));
    const chip = (sub, qs) => {
      const n = qs.filter(q => q.c === sub).length, bad = qs.filter(q => q.c === sub && P[q.id] && P[q.id].r !== 1).length;
      return el('button', {class: off.has(sub) ? '' : 'on', title: off.has(sub) ? '눌러서 넣기' : '눌러서 빼기',
        onclick: () => { off.has(sub) ? off.delete(sub) : off.add(sub); setProfOff(pf, off); }},
        `${SUBS[sub] || sub} ${n}` + (bad ? ` · ✕${bad}` : ''));
    };
    const allOn = !jsubs.concat(psubs).some(s => off.has(s));
    const row = (label, subs, qs) => el('div', {style:'margin-top:8px'},
      el('div', {style:'font-size:12px;color:var(--ink3);margin-bottom:4px'}, label),
      el('div', {class:'seg'}, subs.map(sb => chip(sb, qs))));
    return el('div', {class:'task', style:'flex-direction:column;align-items:stretch'},
      el('div', {class:'tt', style:'flex:none;width:100%'}, el('b', null, `${pf.n} `), el('span', {style:'color:var(--ink3);font-size:12px'}, `중간 ${pf.w}`),
        el('small', null, pf.what)),
      row('족보 단원 (눌러서 넣기·빼기)', jsubs, JBQ), row('예상문제 단원', psubs, PQ),
      el('div', {style:'display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center'},
        el('button', {class:'btn sm ghost', disabled: allOn, onclick: () => setProfOff(pf, new Set())}, '모두 넣기'),
        el('button', {class:'btn sm ghost', disabled: !onJ.length && !onP.length, onclick: () => setProfOff(pf, new Set(jsubs.concat(psubs)))}, '모두 빼기'),
        el('button', {class:'btn sm', disabled: !onJ.length, onclick: () => { sel.clear(); onJ.forEach(x => sel.add(x)); saveSel(); renderHome(); $('#regions').scrollIntoView({behavior:'smooth'}); }}, '아래 목록에 적용'),
        el('button', {class:'btn sm', disabled: !jq.length, onclick: () => startSession(jq, `${pf.n} 족보`)}, `족보 ${jq.length}`),
        el('button', {class:'btn sm', disabled: !pq.length, onclick: () => startSession(pq, `${pf.n} 예상문제`)}, `예상 ${pq.length}`),
        el('button', {class:'btn sm primary', disabled: !(jq.length + pq.length), onclick: () => startSession((prefs.pmode === 'random' ? shuffle : (l => sortByFolder(l, () => 0)))(jq.concat(pq)), `${pf.n} 족보+예상문제`)}, `족보+예상 ${jq.length + pq.length}`)));
  });
  const modeSeg = el('div', {class:'seg'}, PMODES.map(([k, lab]) =>
    el('button', {class: (prefs.pmode || 'all') === k ? 'on' : '', onclick: () => { prefs.pmode = k; lsSet(LS_KEY, snapshot()); renderPlan(); }}, lab)));
  const mb = el('button', {class:'btn sm' + (prefs.pmaybe ? ' on' : ''), onclick: () => { prefs.pmaybe = !prefs.pmaybe; lsSet(LS_KEY, snapshot()); renderPlan(); }},
    prefs.pmaybe ? '애매한 단원 포함 중' : '애매한 단원 빼는 중');
  box.replaceChildren(el('div', {class:'panel plan'},
    el('div', {class:'dd'}, el('b', {style:'font-size:17px'}, '2026 교수님 범위로 족보 모으기'), el('span', {class:'note', style:'margin:0', text:'24~28기 족보를 올해 교수계획서 담당 범위로 다시 나눴어요'})),
    el('div', {style:'margin-top:8px;font-size:13px;color:var(--ink2)'}, '풀 문제: ', modeSeg),
    el('div', {class:'today'}, cards),
    el('div', {class:'opts'}, mb, el('span', {class:'note', style:'margin:0', text:'애매한 단원: ' + Object.keys(MAYBE_NOTE).map(k => SUBS[k]).join(', ')})),
    el('details', null, el('summary', null, '애매한 단원을 나눈 이유'),
      el('div', {class:'note', style:'white-space:pre-line', text: Object.entries(MAYBE_NOTE).map(([k, v]) => `• ${k} ${v}`).join('\n')}))));
}

/* ---- 주제별 폴더: group a question list by topic (소단원 이름) ---- */
const OPENF = new Set();
function folderOf(q){ return (SUBS[q.c] || q.c || '기타').trim(); }
function sortByFolder(list, within){
  const order = new Map();
  [...new Set(list.map(folderOf))].sort((a, b) => a.localeCompare(b, 'ko')).forEach((k, i) => order.set(k, i));
  return list.slice().sort((a, b) => order.get(folderOf(a)) - order.get(folderOf(b)) || within(a, b));
}
function foldUp(list, items, title, opt){
  opt = opt || {};
  const wrap = el('div');
  const groups = new Map();
  list.forEach((q, i) => { const k = folderOf(q); if (!groups.has(k)) groups.set(k, []); groups.get(k).push([q, items[i]]); });
  if (groups.size <= 2) groups.forEach((_, k) => OPENF.add(title + '|' + k));
  for (const [k, rows] of groups) {
    const qs = rows.map(r => r[0]), key = title + '|' + k;
    const wrong = qs.reduce((s, q) => s + wrongN(q.id), 0);
    const nP = qs.filter(q => q.set === 'p').length;
    const picked = opt.pick ? qs.filter(q => STUDYSEL.has(q.id)).length : 0;
    const stop = fn => ev => { ev.preventDefault(); ev.stopPropagation(); fn(); };
    const d = el('details', {class:'panel fold'});
    if (OPENF.has(key)) d.open = true;
    d.addEventListener('toggle', () => { d.open ? OPENF.add(key) : OPENF.delete(key); });
    d.append(el('summary', null,
      opt.pick ? el('span', {class:'chk' + (picked === qs.length ? ' on' : ''), title:'이 폴더 전부 PDF에 넣기/빼기', style:'cursor:pointer',
        onclick: stop(() => { picked === qs.length ? qs.forEach(q => STUDYSEL.delete(q.id)) : qs.forEach(q => STUDYSEL.add(q.id)); opt.redraw(); })}) : null,
      el('span', {class:'ar', text:'▶'}),
      el('div', {class:'fn'}, '📁 ' + k, el('small', null, `${qs.length}문제` + (wrong ? ` · 틀린 횟수 합 ${wrong}` : '') + (nP && nP < qs.length ? ` · 예상문제 ${nP} / 족보 ${qs.length - nP}` : nP ? ' · 예상문제' : ' · 족보') + (opt.pick && picked ? ` · PDF 선택 ${picked}` : ''))),
      el('button', {class:'btn sm', onclick: stop(() => openPdfMaker(qs, `${title} · ${k}`))}, '📄 PDF'),
      el('button', {class:'btn sm primary', onclick: stop(() => startSession(qs, `${title} · ${k}`))}, '풀기')),
      el('ul', {class:'panel wl'}, rows.map(r => r[1])));
    wrap.append(d);
  }
  return wrap;
}
/* ---- study plan, spaced review, shuffled options ---- */
const EXAM = {date: '2026-10-28', label: '10/28(수) 중간고사'};
const ALLP = ['K1','K2','K3','K4','K5','K6','K7','J1','J2','J3','J4','Y1','Y2','Y3','Y4','Y5'];
const PLAN = [
  ['2026-10-08', '배벽 강의(윤상필) 날', [['윤상필p 총론·배벽·샅굴 1회독', ['Y1','Y2'], 'order']]],
  ['2026-10-09', '창자 강의(윤상필) 날 · 다음 주 수업 당겨짐', [['강의 들은 날 저녁: 복막·창자', ['Y3'], 'order'], ['김진우p 학생발표 원문 1회독 — 그대로 출제될 수 있는 문제', ['J1'], 'order']]],
  ['2026-10-10', '소화기 부속샘 강의(윤상필) 날 · 다음 주 수업 당겨짐', [['강의 들은 날 저녁: 간·쓸개·이자·지라', ['Y4'], 'order'], ['김진우p 학생발표 변형 + 상지 조합형', ['J2','J3'], 'order']]],
  ['2026-10-11', '김진우p 총론·등 + 실습', [['총론·등 + 실습·임상(카데바) 시나리오', ['J4','K6'], 'order'], ['오늘 복습', ALLP, 'due']]],
  ['2026-10-12', '김정태p 1', [['골학 + 넙다리·볼기', ['K1','K2'], 'order']]],
  ['2026-10-13', '김정태p 2', [['종아리·발 + 다리의 관절', ['K3','K4'], 'order'], ['오늘 복습', ALLP, 'due']]],
  ['2026-10-14', '김정태p 3', [['가슴우리·가슴벽 + 심장·허파·가슴막·젖', ['K5','K7'], 'order']]],
  ['2026-10-15', '윤상필p 마무리', [['윤상필p 혈관·신경·임상 연계', ['Y5'], 'order'], ['오늘 복습', ALLP, 'due']]],
  ['2026-10-16', '1회독 끝 · 족보', [['오늘 복습', ALLP, 'due'], ['「범위 고르기」 탭에서 JB 족보 한 바퀴', null, null]]],
  ['2026-10-17', '김진우p 2회독', [['김진우p 틀림·모름만 → 📄 PDF로 묶어 형광펜 문장 읽기', ['J1','J2','J3','J4'], 'review']]],
  ['2026-10-18', '김정태p 2회독', [['김정태p 틀림·모름만 → PDF 묶기', ['K1','K2','K3','K4','K5','K6','K7'], 'review']]],
  ['2026-10-19', '윤상필p 2회독', [['윤상필p 틀림·모름만 → PDF 묶기', ['Y1','Y2','Y3','Y4','Y5'], 'review']]],
  ['2026-10-20', 'CBL 날', [['오늘 복습', ALLP, 'due'], ['「범위 고르기」 탭에서 JB 족보 틀림·모름만', null, null]]],
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
  if (currentTab() === 'pick') { renderProfBox(box); return; }
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
