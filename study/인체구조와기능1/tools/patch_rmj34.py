"""채점기: 김진우p 예전 스타일 예상문제(J3 상지 조합형 · J4 총론·등) 빼기 — 학생발표 문제(J1·J2·J5·J6)와 헷갈리지 않게

- 문제 데이터에서 J3·J4 문항과 소단원 이름을 지움
- 교수님별 상자·전 범위(ALLP)·일정표에서 J3·J4를 뺌 (지난 일정은 남은 묶음으로 바꿈)

usage: python3 -I patch_rmj34.py <page.html> <out.html>
"""
import json, re, sys
src, out = sys.argv[1:3]
h = open(src, encoding='utf-8').read()
DROP = ('J3', 'J4')

def rep(old, new):
    global h
    assert h.count(old) == 1, (h.count(old), old[:90])
    h = h.replace(old, new)

m = re.search(r'(<script id="pdata" type="application/json">)(.*?)(</script>)', h, re.S)
pd = json.loads(m.group(2).replace('<\\/', '</'))
n0 = len(pd['q'])
pd['q'] = [q for q in pd['q'] if q['c'] not in DROP]
for c in DROP: pd['subs'].pop(c, None)
h = h[:m.start(2)] + json.dumps(pd, ensure_ascii=False).replace('</', '<\\/') + h[m.end(2):]

rep("p:['J1','J2','J3','J4','J5','J6']}", "p:['J1','J2','J5','J6']}")
rep("'J1','J2','J3','J4','J5','J6','Y1'", "'J1','J2','J5','J6','Y1'")
rep("['김진우p 학생발표 변형 + 상지 조합형', ['J2','J3'], 'order']", "['김진우p 학생발표 변형', ['J2'], 'order']")
rep("'김진우p 총론·등 + 실습', [['총론·등 + 실습·임상(카데바) 시나리오', ['J4','K6'], 'order']", "'김진우p 등 + 실습', [['김진우p 학생발표 원문 · 등', ['J5'], 'order']")
rep("['J1','J2','J3','J4','J5','J6'], 'review']", "['J1','J2','J5','J6'], 'review']")
assert not re.search(r"'J[34]'", h)
open(out, 'w', encoding='utf-8').write(h)
print('ok', n0, '->', len(pd['q']))
