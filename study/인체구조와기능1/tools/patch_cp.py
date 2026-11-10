"""채점기: 김진우p 학생발표 원본(옆 창의 숨은 발표 항목 D01~)도 🖊 수업 PDF(classpdf://)로 열기

수업 PDF 앱은 내 컴퓨터의 파일을 이름(n)·크기(s)·이름 패턴(rx)으로 찾으므로, 발표마다
드라이브 원본 이름·크기(PDF, pptx 둘 다)를 kjw_cp.json에서 넣고, 못 찾을 때 받을 수 있게 채점기 자료 주소(u)도 붙인다.

usage: python3 -I patch_cp.py <page.html> <out.html>
"""
import json, re, sys
from pathlib import Path
src, out = sys.argv[1:3]
h = open(src, encoding='utf-8').read()
CP = json.loads((Path(__file__).parent / 'kjw_cp.json').read_text())

def rx_of(name):
    toks = [t for t in re.split(r'[\s_\-.·()\[\]]+', name) if t]
    return '.*'.join(re.escape(t) for t in toks)

data = {f: {'n': v['n'], 's': v['s'], 'rx': rx_of(v['n'])} for f, v in CP.items()}

def rep(old, new):
    global h
    assert h.count(old) == 1, (h.count(old), old[:90])
    h = h.replace(old, new)

rep("""function cpLink(s){
  const B = BOOKS[s.b]; if (!B || B.hide || !s.p) return null;
  const q = new URLSearchParams({b:s.b, n:B.name, p:String(s.p)});""",
"""const KJW_CP = """ + json.dumps(data, ensure_ascii=False) + """;   // 학생발표 원본: 드라이브 파일 이름·크기·이름 패턴
function cpLink(s){
  const B = BOOKS[s.b]; if (!B || !s.p) return null;
  if (B.hide) {   // 옆 창용 숨은 항목 중 김진우p 학생발표(D01~)만
    const f = /^D\\d+$/.test(s.b) && Object.keys(KJW_DECK).find(x => KJW_DECK[x] === s.b), c = f && KJW_CP[f];
    if (!c) return null;
    const q = new URLSearchParams({b:'KJW-' + f, n:c.n, p:String(s.p)});
    if (c.s && c.s.length) q.set('s', c.s.join(','));
    if (c.rx) q.set('rx', c.rx);
    if (BUILTIN[s.b]) q.set('u', new URL(BUILTIN[s.b], location.href).href);
    return 'classpdf://open?' + q.toString();
  }
  const q = new URLSearchParams({b:s.b, n:B.name, p:String(s.p)});""")
open(out, 'w', encoding='utf-8').write(h)
print('ok', len(data))
