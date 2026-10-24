"""예상문제에 슬라이드 캡처 붙이기: 문제 그림(q.qi)은 문제 카드 아래, 해설 근거 쪽(q.xi)은 해설 아래.
이미지는 artifact 파일 pimg/<name>.jpg 로 함께 배포한다."""
import sys
src, out = sys.argv[1:3]
h = open(src, encoding='utf-8').read()

def rep(s, old, new):
    assert s.count(old) == 1, (s.count(old), old[:80])
    return s.replace(old, new)

h = rep(h, '.qtext{white-space:pre-wrap;',
        '.pimg{display:block;max-width:100%;height:auto;margin:12px auto 0;border-radius:8px;border:1px solid var(--line);background:#fff}\n'
        '.pxfig{margin:12px 0 0}.pxfig figcaption{font-size:12.5px;color:var(--muted,#888);margin-top:4px;text-align:center}\n'
        '.qtext{white-space:pre-wrap;')
h = rep(h, "  if (base.set === 'p') imgc.replaceChildren(el('div', {class:'qtext', text: q.tx}));",
        "  if (base.set === 'p') imgc.replaceChildren(el('div', {class:'qtext', text: q.tx}), ...(q.qi || []).map(f => el('img', {class:'pimg', src:'pimg/' + f, alt:'문제 그림', loading:'lazy'})));")
h = rep(h, "    if (q.ni) box.append(notionImgBox(q));",
        "    if (q.ni) box.append(notionImgBox(q));\n"
        "    if (q.xi && q.xi.length) box.append(el('div', {class:'note', text:'📑 해설 근거 — 문제를 낸 발표 PPT 슬라이드'}), ...q.xi.map(x => el('figure', {class:'pxfig'}, el('img', {class:'pimg', src:'pimg/' + x.f, alt:x.cap, loading:'lazy'}), el('figcaption', {text:x.cap}))));")
open(out, 'w', encoding='utf-8').write(h)
print('ok')
