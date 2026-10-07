"""Add the 참고 페이지 PDF maker to the (already 예상문제-patched) 채점기 page."""
import sys
src, js, out = sys.argv[1:4]
h = open(src, encoding='utf-8').read()
maker = open(js, encoding='utf-8').read()

def rep(old, new):
    global h
    n = h.count(old)
    assert n == 1, (n, old[:90])
    h = h.replace(old, new)

assert 'openPdfMaker' not in h
rep("/* boot */\n", maker + "\n/* boot */\n")

# 추가 공부: button next to the play buttons
rep("""    el('div', {style:'display:flex;gap:6px'},
      el('button', {class:'btn sm', onclick: () => startSession(shuffle(list.slice()), '추가 공부 (무작위)')}, '무작위로 풀기'),""",
    """    el('div', {style:'display:flex;gap:6px;flex-wrap:wrap'},
      el('button', {class:'btn sm', onclick: () => openPdfMaker(list, '추가 공부')}, '📄 PDF로 묶기'),
      el('button', {class:'btn sm', onclick: () => startSession(shuffle(list.slice()), '추가 공부 (무작위)')}, '무작위로 풀기'),""")
# 복습 노트 (latest view)
rep("""      list.length ? bulkStudyBtn(list) : null,
      list.length ? el('button', {class:'btn sm primary', onclick: () => startSession(list, '복습 노트')}, `${list.length}문제 다시 풀기`) : null)));""",
    """      list.length ? bulkStudyBtn(list) : null,
      list.length ? el('button', {class:'btn sm', onclick: () => openPdfMaker(list, '복습 노트')}, '📄 PDF로 묶기') : null,
      list.length ? el('button', {class:'btn sm primary', onclick: () => startSession(list, '복습 노트')}, `${list.length}문제 다시 풀기`) : null)));""")
# 복습 노트 (count view)
rep("""        list.length ? bulkStudyBtn(list) : null,
        list.length ? el('button', {class:'btn sm primary', onclick: () => startSession(list, `틀린 횟수 ${prefs.wmin}회 이상`)}, `${list.length}문제 풀기`) : null)));""",
    """        list.length ? bulkStudyBtn(list) : null,
        list.length ? el('button', {class:'btn sm', onclick: () => openPdfMaker(list, `틀린 횟수 ${prefs.wmin}회 이상`)}, '📄 PDF로 묶기') : null,
        list.length ? el('button', {class:'btn sm primary', onclick: () => startSession(list, `틀린 횟수 ${prefs.wmin}회 이상`)}, `${list.length}문제 풀기`) : null)));""")
# study tab intro text mentions the PDF
rep("""'으로 빼면 돼요.'));""", """'으로 빼면 돼요. ', el('b', null, '📄 PDF로 묶기'), '를 누르면 해설이 근거로 든 교재·PPT 쪽을 한 파일로 모아 줘요.'));""")
# explanation: list the cited pages
rep("    if (q.ni) box.append(notionImgBox(q));",
    "    if (q.ni) box.append(notionImgBox(q));\n    { const rs = refsOf(q); if (rs.length) box.append(el('div', {class:'note', text:'📖 참고 페이지: ' + rs.map(refLabel).join(', ')})); }")

open(out, 'w', encoding='utf-8').write(h)
print('ok', len(h))
