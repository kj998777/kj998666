"""Merge the new 예상문제 data + slide-capture support onto the live artifact version."""
import sys, re, json
live_p, pred_p, out_p = sys.argv[1:4]
raw = open(live_p, encoding='utf-8').read()
start = raw.index('<!doctype html>\n<html lang="ko">')
h = raw[start:].rstrip()
assert h.endswith('</body></html>')
h = h[:-len('</body></html>')].rstrip() + '\n'
assert h.rstrip().endswith('</html>')

def rep(s, old, new):
    assert s.count(old) == 1, (s.count(old), old[:80])
    return s.replace(old, new)

# pdata: new questions/explanations; keep the live refs where the live copy has them
m = re.search(r'(<script id="pdata" type="application/json">)(.*?)(</script>)', h, re.S)
live = json.loads(m.group(2).replace('<\\/', '</'))
new = json.loads(open(pred_p, encoding='utf-8').read())
LV = {q['id']: q for q in live['q']}
nref = 0
for q in new['q']:
    o = LV.get(q['id'])
    if o and o.get('refs') != q.get('refs'):
        q['refs'] = o.get('refs'); nref += 1
    if o:
        extra = set(o) - set(q)
        for k in extra: q[k] = o[k]
pdata = json.dumps(new, ensure_ascii=False).replace('</', '<\\/')
h = h[:m.start(2)] + pdata + h[m.end(2):]

# scope / plan (same edits as tools/patch3.py)
h = rep(h, "p:['J1','J2','J3','J4']}", "p:['J1','J2','J3','J4','J5','J6']}")
h = rep(h, "const ALLP = ['K1','K2','K3','K4','K5','K6','K7','J1','J2','J3','J4',", "const ALLP = ['K1','K2','K3','K4','K5','K6','K7','J1','J2','J3','J4','J5','J6',")
h = rep(h, "['김진우p 틀림·모름만 → 📄 PDF로 묶어 형광펜 문장 읽기', ['J1','J2','J3','J4']", "['김진우p 틀림·모름만 → 📄 PDF로 묶어 형광펜 문장 읽기', ['J1','J2','J3','J4','J5','J6']")
h = rep(h, "  ['2026-10-20', 'CBL 날', [['오늘 복습', ALLP, 'due'],", "  ['2026-10-20', 'CBL 날', [['새로 추가된 김진우p 학생발표 원문 — 등·골반 (해설에 발표 슬라이드 캡처)', ['J5','J6'], 'order'], ['오늘 복습', ALLP, 'due'],")
h = rep(h, "[['학생발표 원문·변형 최종 점검', ['J1','J2'], 'order']", "[['학생발표 원문·변형 최종 점검', ['J1','J2','J5','J6'], 'order']")

# slide captures (same edits as tools/patch4.py)
h = rep(h, '.qtext{white-space:pre-wrap;',
        '.pimg{display:block;max-width:100%;height:auto;margin:12px auto 0;border-radius:8px;border:1px solid var(--line);background:#fff}\n'
        '.pxfig{margin:12px 0 0}.pxfig figcaption{font-size:12.5px;color:var(--ink3);margin-top:4px;text-align:center}\n'
        '.qtext{white-space:pre-wrap;')
h = rep(h, "  if (base.set === 'p') imgc.replaceChildren(el('div', {class:'qtext', text: q.tx}));",
        "  if (base.set === 'p') imgc.replaceChildren(el('div', {class:'qtext', text: q.tx}), ...(q.qi || []).map(f => el('img', {class:'pimg', src:'pimg/' + f, alt:'문제 그림', loading:'lazy'})));")
h = rep(h, "    if (q.ni) box.append(notionImgBox(q));",
        "    if (q.ni) box.append(notionImgBox(q));\n"
        "    if (q.xi && q.xi.length) box.append(el('div', {class:'note', text:'📑 해설 근거 — 문제를 낸 발표 PPT 슬라이드'}), ...q.xi.map(x => el('figure', {class:'pxfig'}, el('img', {class:'pimg', src:'pimg/' + x.f, alt:x.cap, loading:'lazy'}), el('figcaption', {text:x.cap}))));")
open(out_p, 'w', encoding='utf-8').write(h)
print('ok', len(new['q']), 'refs kept from live', nref, len(h))
