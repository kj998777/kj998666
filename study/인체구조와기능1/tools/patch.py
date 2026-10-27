"""Add a 예상문제 tab to the JB 채점기 page, reusing its picker/quiz engine."""
import sys, json
src, pred, out = sys.argv[1:4]
raw = open(src, encoding='utf-8').read()

# strip the artifact-service wrapper (first line prefix + trailing </body></html>)
start = raw.index('<!doctype html>\n<html lang="ko">')
inner = raw[start:]
if inner.rstrip().endswith('</html>\n\n</body></html>') or inner.rstrip().endswith('</body></html>'):
    inner = inner.rstrip()
    assert inner.endswith('</body></html>')
    inner = inner[:-len('</body></html>')].rstrip() + '\n'
assert inner.rstrip().endswith('</html>'), inner[-200:]

def rep(s, old, new, count=1):
    n = s.count(old)
    assert n == count, (n, old[:80])
    return s.replace(old, new)

h = inner
pdata = open(pred, encoding='utf-8').read()
json.loads(pdata)
pdata = pdata.replace('</', '<\\/')
if '<script id="pdata"' in h:
    raise SystemExit('already patched')

# data block + CSS + tab button + header id
h = rep(h, '<script>\n(function(){\n"use strict";',
        '<script id="pdata" type="application/json">' + pdata + '</script>\n<script>\n(function(){\n"use strict";')
h = rep(h, '.hidden{display:none!important}',
        '.hidden{display:none!important}\n.qcard{padding:14px 16px}\n.qtext{white-space:pre-wrap;font-size:15.5px;line-height:1.75;word-break:keep-all;overflow-wrap:anywhere}')
h = rep(h, '<button data-tab="pick" class="on">범위 고르기</button>',
        '<button data-tab="pick" class="on">범위 고르기</button>\n      <button data-tab="pred">예상문제</button>')
h = rep(h, '<div class="sub">24–28기 족보 · 중간고사 범위(1–9주차) 748문항</div>',
        '<div class="sub" id="appsub">24–28기 족보 · 중간고사 범위(1–9주차) 748문항</div>')

# data model
h = rep(h, "const Q = DATA.q, BYID = {};\nQ.forEach(q => BYID[q.id] = q);\nconst REG = DATA.regions, SUBS = DATA.subs;",
        """const PDATA = JSON.parse(document.getElementById('pdata').textContent);
PDATA.q.forEach(q => q.set = 'p');
const JBQ = DATA.q, PQ = PDATA.q;
const Q = JBQ.concat(PQ), BYID = {};
Q.forEach(q => BYID[q.id] = q);
const REG = DATA.regions, PREG = PDATA.regions, SUBS = Object.assign({}, DATA.subs, PDATA.subs);
let curSet = 'jb';
const SETQ = () => curSet === 'p' ? PQ : JBQ;
const SETREG = () => curSet === 'p' ? PREG : REG;
const JBSUB = '24–28기 족보 · 중간고사 범위(1–9주차) ' + JBQ.length + '문항';
const PSUB = '교수님별 예상문제 · 중간고사 범위 ' + PQ.length + '문항';
const PFOOT = '예상문제는 교수님별로 나눴어요. 김정태p는 본인 강의 PPT 문장 기반, 김진우p는 학생 발표 문제 원문·변형(교수님 출제분의 약 절반 예상) + 상지·총론, 윤상필p는 해부학 길라잡이 기반이에요. 여러 가지를 쓰는 주관식은 정답과 비교해 직접 판정해요. 풀이 기록·복습 노트·추가 공부는 족보와 함께 모여요.';""")

# stats / regions / pool / selection use the current set
h = rep(h, "const st = tally(Q.filter(q => eff(q).t !== 'none'));", "const st = tally(SETQ().filter(q => eff(q).t !== 'none'));")
h = rep(h, "const notion = Q.filter(q => q.es !== 'claude'", "const notion = SETQ().filter(q => q.es !== 'claude'")
h = rep(h, "text: nfix ? `선배·노션·교재 해설 · 수정 ${nfix}` : '선배·노션·교재 해설'}",
        "text: curSet === 'p' ? '교수님별 예상문제' : nfix ? `선배·노션·교재 해설 · 수정 ${nfix}` : '선배·노션·교재 해설'}")
h = rep(h, "String(notion), el('small', null, ' / ' + Q.length)", "String(notion), el('small', null, ' / ' + SETQ().length)")
h = rep(h, "function regionSubs(r){ return Object.keys(SUBS).filter(s => s[0] === r && Q.some(q => q.c === s)); }",
        "function regionSubs(r){ return Object.keys(SUBS).filter(s => s[0] === r && SETQ().some(q => q.c === s)); }")
h = rep(h, "  for (const r of Object.keys(REG)) {\n    const subs = regionSubs(r);\n    const st = tally(Q.filter(q => q.c[0] === r));",
        "  const RG = SETREG();\n  for (const r of Object.keys(RG)) {\n    const subs = regionSubs(r);\n    const st = tally(SETQ().filter(q => q.c[0] === r));")
h = rep(h, "'aria-label': REG[r] + ' 전체 선택'", "'aria-label': RG[r] + ' 전체 선택'")
h = rep(h, "el('div', {class:'nm'}, REG[r], el('span', null, `${st.tot}문항`))", "el('div', {class:'nm'}, RG[r], el('span', null, `${st.tot}문항`))")
h = rep(h, "  let pool = Q.filter(q => sel.has(q.c));", "  let pool = SETQ().filter(q => sel.has(q.c));")
h = rep(h, "  const all = Q.filter(q => sel.has(q.c)).length;",
        "  const all = SETQ().filter(q => sel.has(q.c)).length;\n  const nsel = [...sel].filter(s => s[0] in SETREG()).length;")
h = rep(h, "$('#selinfo').textContent = sel.size ? `선택 ${sel.size}개 소단원",
        "$('#selinfo').textContent = nsel ? `선택 ${nsel}개 소단원")
h = rep(h, "  const names = [...sel].sort().map(s => SUBS[s]);",
        "  const names = [...sel].filter(s => s[0] in SETREG()).sort().map(s => SUBS[s]);")

# tabs: 예상문제 reuses the pick view with the prediction set
h = rep(h, "  const t = b.dataset.tab;\n  $('#pickView').classList.toggle('hidden', t !== 'pick');",
        "  const t = b.dataset.tab;\n  if (t === 'pick' || t === 'pred') { curSet = t === 'pred' ? 'p' : 'jb'; $('#appsub').textContent = curSet === 'p' ? PSUB : JBSUB; }\n  $('#pickView').classList.toggle('hidden', t !== 'pick' && t !== 'pred');")
h = rep(h, "  $('#foot').textContent = `정답·해설 출처:", "  $('#foot').textContent = curSet === 'p' ? PFOOT : `정답·해설 출처:")

# quiz: no image files for prediction questions — show the text instead
h = rep(h, "  [...new Set(S.list.map(q => q.c[0]))].forEach(r => loadRegion(r).catch(() => {}));",
        "  [...new Set(S.list.filter(q => !q.set).map(q => q.c[0]))].forEach(r => loadRegion(r).catch(() => {}));")
h = rep(h, "  const imgc = el('div', {class:'imgcard'});", "  const imgc = el('div', {class: base.set === 'p' ? 'panel qcard' : 'imgcard'});")
h = rep(h, "  if (window.__IMG[q.id]) showImg();\n  else {\n    imgc.append(el('div', {class:'ld', text:'문제 불러오는 중…'}));",
        "  if (base.set === 'p') imgc.replaceChildren(el('div', {class:'qtext', text: q.tx}));\n  else if (window.__IMG[q.id]) showImg();\n  else {\n    imgc.append(el('div', {class:'ld', text:'문제 불러오는 중…'}));")
h = rep(h, "    else if (q.es === 'claude-nobook') { srcCls = 'claude'; srcLab = 'Claude 풀이 · 교재에서 근거를 못 찾음'; }",
        "    else if (q.es === 'pred') { srcCls = 'book'; srcLab = '🔮 예상문제 해설'; }\n    else if (q.es === 'claude-nobook') { srcCls = 'claude'; srcLab = 'Claude 풀이 · 교재에서 근거를 못 찾음'; }")

open(out, 'w', encoding='utf-8').write(h)
print('ok', len(raw), '->', len(h))
