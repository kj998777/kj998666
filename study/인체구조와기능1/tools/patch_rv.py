"""채점기 옆 창(📖)을 다른 탭에서도 쓸 수 있게: window.__bvDoc(url, 이름, 쪽)
땡시 「사진으로 공부하기」의 실습리뷰 원본(자료 저장소 PDF)을 문제와 상관없이 그 쪽부터 연다.
cad.js 주소 끝의 ?v= 를 올려 브라우저가 새 cad.js를 받게 한다.

usage: python3 -I patch_rv.py <page.html> <out.html> <cad 버전 문자열>
"""
import sys
src, out, ver = sys.argv[1:4]
h = open(src, encoding='utf-8').read()

def rep(s, old, new):
    assert s.count(old) == 1, (s.count(old), old[:80])
    return s.replace(old, new)

if 'window.__bvDoc' not in h:
    h = rep(h, "function bvOpen(q, idx){",
            "// 문제 없이 PDF 하나를 옆 창에 띄움 (땡시 실습리뷰 원본 등). 이름표는 숨은 BOOKS 항목으로 등록\n"
            "window.__bvDoc = (url, name, page) => {\n"
            "  const k = 'RV' + String(url).replace(/[^a-z0-9]/gi, '').slice(-10);\n"
            "  if (!BOOKS[k]){ BOOKS[k] = {name, sizes:[], rx:null, hide:true}; BUILTIN[k] = url; }\n"
            "  BV.q = null; BV.list = [{kind:'pdf', b:k, p:page || 1, label:name}]; BV.zoom = 1; BV.open = true; BV.min = false;\n"
            "  bvPanel(); bvLayout(); bvGo(0);\n"
            "};\n"
            "function bvOpen(q, idx){")
import re
h, n = re.subn(r"cad/cad\.js\?v=[\w.]+", f"cad/cad.js?v={ver}", h)
assert n == 1, n
open(out, 'w', encoding='utf-8').write(h)
print('ok', len(h))
