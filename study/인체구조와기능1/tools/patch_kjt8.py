"""김정태p 형성평가형 65문항(K8 출제 유력 · K9 지엽) + 난이도(하·중·상) 고르기

- 범위 고르기 아래에 '난이도' 줄: 전체 / 하 / 중 / 상 / 쉬운 순(하→중→상). 고른 범위에 난이도가 붙은 문항이 있을 때만 보임
- 문제 화면 칩에 '난이도 중' 표시
- 교수님별 범위(PROF)·전체 목록(ALLP)에 K8·K9 추가, 10/23·10/24 계획에 형성평가형 풀기 추가

usage: python3 -I patch_kjt8.py <page.html> <out.html>
"""
import sys
src, out = sys.argv[1:3]
h = open(src, encoding='utf-8').read()

def rep(s, old, new):
    assert s.count(old) == 1, (s.count(old), old[:80])
    return s.replace(old, new)

if 'id="lvseg"' in h:
    raise SystemExit('already patched')

h = rep(h, "p:['K1','K2','K3','K4','K5','K6','K7']},", "p:['K1','K2','K3','K4','K5','K6','K7','K8','K9']},")
h = rep(h, "const ALLP = ['K1','K2','K3','K4','K5','K6','K7',", "const ALLP = ['K1','K2','K3','K4','K5','K6','K7','K8','K9',")
h = rep(h, "  ['2026-10-23', '섞어 풀기', [['전 범위 무작위 — 단원을 섞어야 진짜 실력이 보여요', ALLP, 'random']]],",
        "  ['2026-10-23', '섞어 풀기', [['김정태p 형성평가형 · 출제 유력 53 — 난이도 쉬운 순으로', ['K8'], 'order'], ['전 범위 무작위 — 단원을 섞어야 진짜 실력이 보여요', ALLP, 'random']]],")
h = rep(h, "  ['2026-10-24', '약점 집중', [['틀린 횟수 2회 이상만', ALLP, 'wcount', 2]]],",
        "  ['2026-10-24', '약점 집중', [['김정태p 형성평가형 · 지엽 12', ['K9'], 'order'], ['틀린 횟수 2회 이상만', ALLP, 'wcount', 2]]],")

# 난이도 줄 (모드 줄 바로 아래)
h = rep(h, '        <div class="stepper hidden" id="wstep"></div>',
        '        <div class="seg hidden" id="lvseg" aria-label="난이도">\n'
        '          <span class="lvlab">난이도</span>\n'
        '          <button data-lv="0" class="on">전체</button>\n'
        '          <button data-lv="1">하</button>\n'
        '          <button data-lv="2">중</button>\n'
        '          <button data-lv="3">상</button>\n'
        '          <button data-lv="9">쉬운 순</button>\n'
        '        </div>\n'
        '        <div class="stepper hidden" id="wstep"></div>')
h = rep(h, ".modebar .seg{flex:1 1 100%}", ".modebar .seg{flex:1 1 100%}\n#lvseg{align-items:center}#lvseg .lvlab{font-size:12.5px;color:var(--ink3);margin-right:2px}\n.chip.lv1{background:var(--ok-soft);color:var(--ok)}.chip.lv2{background:var(--warn-soft);color:var(--warn)}.chip.lv3{background:var(--bad-soft);color:var(--bad)}.chip.st{background:transparent;border:1px solid var(--line);color:#dc2626;letter-spacing:-1px}")

# 풀 고르기: 난이도 거르기·정렬 (난이도가 없는 문항은 '전체'일 때만 포함)
h = rep(h, """function poolFor(mode){
  let pool = SETQ().filter(q => sel.has(q.c));""",
"""const LVN = ['', '하', '중', '상'];
function poolFor(mode){
  let pool = SETQ().filter(q => sel.has(q.c));
  const lv = prefs.lv || 0;
  if (lv && pool.some(q => q.lv)) {
    pool = pool.filter(q => q.lv);
    if (lv === 9) pool = pool.slice().sort((a, b) => a.lv - b.lv);
    else pool = pool.filter(q => q.lv === lv);
  }""")
h = rep(h, """  $('#startBtn').disabled = !n;
  document.querySelectorAll('#modes button').forEach(b => b.classList.toggle('on', b.dataset.mode === prefs.mode));""",
"""  $('#startBtn').disabled = !n;
  document.querySelectorAll('#modes button').forEach(b => b.classList.toggle('on', b.dataset.mode === prefs.mode));
  { const has = SETQ().some(q => sel.has(q.c) && q.lv), lvs = $('#lvseg');
    lvs.classList.toggle('hidden', !has);
    lvs.querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.lv === (prefs.lv || 0)));
    if (has && prefs.lv) { const c = {1:0, 2:0, 3:0}; SETQ().forEach(q => { if (sel.has(q.c) && q.lv) c[q.lv]++; });
      $('#selinfo').textContent += prefs.lv === 9 ? ` · 난이도 하 ${c[1]} → 중 ${c[2]} → 상 ${c[3]} 순` : ` · 난이도 ${LVN[prefs.lv]}만 ${c[prefs.lv]}문항`; } }""")
h = rep(h, """$('#modes').addEventListener('click', ev => {""",
"""$('#lvseg').addEventListener('click', ev => {
  const b = ev.target.closest('button'); if (!b) return;
  prefs.lv = +b.dataset.lv; lsSet(LS_KEY, snapshot()); renderSelInfo();
});
$('#modes').addEventListener('click', ev => {""")
# 무작위 모드에서 '쉬운 순'이면 난이도 묶음 안에서만 섞음
h = rep(h, "  if (prefs.mode === 'random') pool = shuffle(pool.slice());",
        "  if (prefs.mode === 'random') pool = prefs.lv === 9 && pool.every(q => q.lv) ? [1, 2, 3].flatMap(v => shuffle(pool.filter(q => q.lv === v))) : shuffle(pool.slice());")
h = rep(h, "    el('span', {class:'chip', text:q.g}),\n    el('span', {class:'chip src', text:q.s}),",
        "    el('span', {class:'chip', text:q.g}),\n    q.lv ? el('span', {class:'chip lv' + q.lv, text:'난이도 ' + LVN[q.lv]}) : null,\n    q.st ? el('span', {class:'chip st', title:'김정태p 정리본 중요도', text:'★'.repeat(q.st)}) : null,\n    el('span', {class:'chip src', text:q.s}),")
# 버전 용량(256 MiB) 한도 때문에 새 해설 캡처는 자료 저장소(/_blob)에 올리고 이름 → 주소 표로 찾는다
import json
from pathlib import Path
BL = json.loads(Path(__file__).with_name('kjt_blobs.json').read_text())
h = rep(h, "const LVN = ['', '하', '중', '상'];",
        "const LVN = ['', '하', '중', '상'];\nconst PIMG_URL = " + json.dumps(BL) + ";\nconst pimgSrc = f => PIMG_URL[f] || 'pimg/' + f;")
h = rep(h, "src:'pimg/' + f, alt:'문제 그림'", "src:pimgSrc(f), alt:'문제 그림'")
h = rep(h, "src:'pimg/' + x.f, alt:x.cap", "src:pimgSrc(x.f), alt:x.cap")
h = h.replace("img:'pimg/' + x.f, label:x.cap", "img:pimgSrc(x.f), label:x.cap")
h = rep(h, "s.img === 'pimg/' + x.f", "s.img === pimgSrc(x.f)")
h = rep(h, "q.id < 92000 ? '📑 해설 근거 — 김정태 교수님 강의 PPT 슬라이드'", "(q.id < 92000 || q.id >= 94000) ? '📑 해설 근거 — 김정태 교수님 강의 PPT 슬라이드'")
open(out, 'w', encoding='utf-8').write(h)
print('ok', len(h))
