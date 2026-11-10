"""채점기: 김진우p 학생발표 문제에도 「선지별 이유 · 근거 쪽」

- 선지별 근거 목록을 하나 더 불러와 합침 (김진우p 학생발표 문제용, 자료 저장소 JSON)
- 근거 쪽 형식 추가: KJW:<발표 파일 id>:<쪽>(옆 창 발표 원본), SA~SD:<쪽>(학생발표 통합본)
- 보기를 섞어 풀 때도 선지 번호·정답 표시가 지금 화면 순서와 맞게

usage: python3 -I patch_kjwor.py <page.html> <out.html> <근거 JSON 주소>
"""
import sys
src, out, url = sys.argv[1:4]
h = open(src, encoding='utf-8').read()

def rep(old, new):
    global h
    assert h.count(old) == 1, (h.count(old), old[:90])
    h = h.replace(old, new)

rep("""const OPTREFS = {d: null, p: null};
function optRefsLoad(){
  if (!OPTREFS.p) OPTREFS.p = fetch('/_blob/539ace2252627351f80b9853edf2c11a').then(r => r.ok ? r.json() : {}).then(d => (OPTREFS.d = d || {})).catch(() => (OPTREFS.d = {}));
  return OPTREFS.p;
}""",
f"""const OPTREFS = {{d: null, p: null}};
const OPTREFS_KJW = '{url}';   // 김진우p 학생발표 문제 (발표 원본 쪽)
function optRefsLoad(){{
  const get = u => fetch(u).then(r => r.ok ? r.json() : {{}}).catch(() => ({{}}));
  if (!OPTREFS.p) OPTREFS.p = Promise.all([get('/_blob/539ace2252627351f80b9853edf2c11a'), get(OPTREFS_KJW)]).then(([a, b]) => (OPTREFS.d = Object.assign({{}}, b || {{}}, a || {{}})));
  return OPTREFS.p;
}}""")
rep("""function optRefParse(code){
  const m = /^(RA|GL|GR|O1|O2|KO|K1|K2|K3|K4|KT|KH):(\\d+)$/.exec(String(code)); if (!m) return null;""",
"""function optRefParse(code){
  const d = /^KJW:(.+):(\\d+)$/.exec(String(code));   // 김진우p 학생발표 원본 쪽 → 옆 창의 숨은 발표 항목
  if (d) return KJW_DECK[d[1]] ? {b: KJW_DECK[d[1]], p: +d[2], raw: false} : null;
  const m = /^(RA|GL|GR|O1|O2|KO|K1|K2|K3|K4|KT|KH|SA|SB|SC|SD):(\\d+)$/.exec(String(code)); if (!m) return null;""")
rep("""function refLabel(r){ return `""",
    """function refLabel(r){ if (/^D\\d+$/.test(r.b) && BOOKS[r.b]) return `${BOOKS[r.b].name.replace(/^학생발표 · /, '').trim()} ${r.p}쪽`; return `""")
# 보기 섞기: 지금 화면 번호로 보여 주기 (S.mix[id][지금 자리] = 원래 자리)
rep("""  box.replaceChildren(el('h4', null, '선지별 이유 · 근거 쪽'));
  for (const u of e.u) {""",
"""  box.replaceChildren(el('h4', null, '선지별 이유 · 근거 쪽'));
  const perm = typeof S !== 'undefined' && S && S.mix && q.set !== 'jb' ? S.mix[q.id] : null;
  const us = perm && perm.length === e.u.length ? perm.map(o => e.u.find(u => optIdx(u.k) === o)).filter(Boolean) : e.u;
  for (const u of us) {""")
rep("""    const ci = optIdx(u.k), isAns = ci >= 0 && (q.a || []).includes(ci + 1);""",
    """    const ci0 = optIdx(u.k), ci = us === e.u ? ci0 : perm.indexOf(ci0), isAns = ci >= 0 && (q.a || []).includes(ci + 1);""")
rep("""el('span', {class:'ok' + (u.ok ? ' y' : ''), title: u.ok ? '옳은 내용' : '틀린 내용'}, u.k || '')""",
    """el('span', {class:'ok' + (u.ok ? ' y' : ''), title: (u.ok ? '옳은 내용' : '틀린 내용') + (us === e.u ? '' : ` · 원래 ${u.k}`)}, us === e.u ? (u.k || '') : CIRC[ci])""")
open(out, 'w', encoding='utf-8').write(h)
print('ok')
