"""📖 옆 창 2차: ① 확대·축소 제스처(맥 트랙패드 핀치, 아이패드·폰 두 손가락, 아이패드 트랙패드, 마우스 Ctrl+휠·더블클릭, 끌어서 이동)
② 김진우p 학생발표 원본 PDF(자료 저장소에 올린 것)를 연결해 캡처 대신 원본 PPT를 해설 쪽부터 넘겨 보기
③ pdf.js 한글(CID) 글꼴용 CMap 설정

usage: python3 -I patch_bv2.py <page.html (patch_bv 적용본)> <kjw_decks.json> <out.html>
"""
import json, sys
src, decks, out = sys.argv[1:4]
h = open(src, encoding='utf-8').read()
D = json.load(open(decks, encoding='utf-8'))

def rep(s, old, new):
    assert s.count(old) == 1, (s.count(old), old[:80])
    return s.replace(old, new)

if 'KJW_DECK' in h:
    raise SystemExit('already patched')

# ② 발표 원본 PDF 등록 (BOOKS/BUILTIN에 숨은 항목으로; 교재 연결 목록에는 안 보이게)
reg = "const KJW_DECK = {}; (() => { const L = " + json.dumps(D, ensure_ascii=False) + ";\n" \
      "  Object.keys(L).forEach((f, i) => { const k = 'D' + String(i + 1).padStart(2, '0'); KJW_DECK[f] = k; BOOKS[k] = {name:L[f].n, sizes:[], rx:null, hide:true}; BUILTIN[k] = L[f].u; }); })();\n"
h = rep(h, "const KJT_BOOK = {os:'KO',", reg + "const KJT_BOOK = {os:'KO',")
h = rep(h, """    if (m && KJT_BOOK[m[1]]) out.push({kind:'pdf', b:KJT_BOOK[m[1]], p:+m[2], img:'pimg/' + x.f, label:x.cap});
    else out.push({kind:'img', img:'pimg/' + x.f, label:x.cap});""",
"""    const d = /^(.+)-(\\d+)\\.jpg$/.exec(x.f);
    if (m && KJT_BOOK[m[1]]) out.push({kind:'pdf', b:KJT_BOOK[m[1]], p:+m[2], img:'pimg/' + x.f, label:x.cap});
    else if (d && KJW_DECK[d[1]]) out.push({kind:'pdf', b:KJW_DECK[d[1]], p:+d[2], img:'pimg/' + x.f, label:x.cap});
    else out.push({kind:'img', img:'pimg/' + x.f, label:x.cap});""")
# 교재 연결 표의 '어떤 자료인가요?' 고르기에서 숨은 항목 빼기
old = "Object.keys(BOOKS).map(k => el('option', {value:k, text:BOOKS[k].name}))"
if h.count(old) == 1:
    h = h.replace(old, "Object.keys(BOOKS).filter(k => !BOOKS[k].hide).map(k => el('option', {value:k, text:BOOKS[k].name}))")

# ③ CMap: 한글 CID 글꼴이 든 PDF도 글자가 보이게
h = rep(h, "rangeChunkSize: 1 << 20, disableAutoFetch: true, disableStream: true, isEvalSupported: false}).promise;",
        "rangeChunkSize: 1 << 20, disableAutoFetch: true, disableStream: true, isEvalSupported: false, cMapUrl: LIBS.pdfjs.replace(/[^/]*$/, '').replace(/build\\/$/, '') + 'cmaps/', cMapPacked: true, standardFontDataUrl: LIBS.pdfjs.replace(/[^/]*$/, '').replace(/build\\/$/, '') + 'standard_fonts/'}).promise;")

# ① 확대·축소: 그리는 크기는 BV.zoom, 제스처 중에는 CSS 크기만 바꾸고 멈추면 선명하게 다시 그림
h = rep(h, "async function bvDraw(){\n  const s = BV.list[BV.i], body = document.getElementById('bvB'); if (!s || !body) return;",
        "async function bvDraw(keep){\n  const s = BV.list[BV.i], body = document.getElementById('bvB'); if (!s || !body) return;\n  const sx = body.scrollLeft, sy = body.scrollTop;")
h = rep(h, "    body.replaceChildren(c); body.scrollTop = 0;",
        "    body.replaceChildren(c); if (keep) { body.scrollLeft = sx; body.scrollTop = sy; } else { body.scrollLeft = 0; body.scrollTop = 0; }")
h = rep(h, "  body.replaceChildren(el('div', {class:'bvMsg'}, `${BV.page}쪽 불러오는 중…`));",
        "  if (!keep) body.replaceChildren(el('div', {class:'bvMsg'}, `${BV.page}쪽 불러오는 중…`));")
h = rep(h, "      el('button', {type:'button', class:'btn sm', title:'작게', onclick: () => { BV.zoom = Math.max(1, BV.zoom - .5); bvDraw(); }}, '－'),\n      el('button', {type:'button', class:'btn sm', title:'크게', onclick: () => { BV.zoom = Math.min(3, BV.zoom + .5); bvDraw(); }}, '＋')));",
        "      el('button', {type:'button', class:'btn sm', title:'작게', onclick: () => bvZoomTo(BV.zoom / 1.25)}, '－'),\n      el('span', {id:'bvZ', style:'min-width:42px;text-align:center'}, '100%'),\n      el('button', {type:'button', class:'btn sm', title:'크게', onclick: () => bvZoomTo(BV.zoom * 1.25)}, '＋')));\n  bvGestures(p.querySelector('.bvB'));")

ZOOM = r'''
/* 확대·축소: (cx, cy)는 화면 좌표 — 그 점이 손가락·커서 밑에 그대로 남게 스크롤을 맞춤 */
function bvZoomTo(z, cx, cy){
  const body = document.getElementById('bvB'); if (!body) return;
  const t = body.querySelector('canvas,img'); z = Math.max(.5, Math.min(5, z));
  const zl = document.getElementById('bvZ'); if (zl) zl.textContent = Math.round(z * 100) + '%';
  if (!t){ BV.zoom = z; return; }
  const r = body.getBoundingClientRect();
  const px = (cx == null ? r.left + r.width / 2 : cx) - r.left, py = (cy == null ? r.top + r.height / 2 : cy) - r.top;
  const w0 = t.offsetWidth || 1, h0 = t.offsetHeight || 1;
  const fx = (body.scrollLeft + px - t.offsetLeft) / w0, fy = (body.scrollTop + py - t.offsetTop) / h0;
  const W = Math.max(240, body.clientWidth - 16);
  BV.zoom = z; t.style.width = Math.round(W * z) + 'px'; t.style.maxWidth = 'none';
  body.scrollLeft = fx * t.offsetWidth + t.offsetLeft - px; body.scrollTop = fy * t.offsetHeight + t.offsetTop - py;
  clearTimeout(BV.zt);
  if (t.tagName === 'CANVAS') BV.zt = setTimeout(() => bvDraw(true), 300);
}
function bvGestures(body){
  body.style.touchAction = 'pan-x pan-y'; body.style.overscrollBehavior = 'contain';
  // 맥·윈도 트랙패드 핀치(Chrome·Edge·Firefox는 ctrl+휠로 들어옴), 마우스 Ctrl+휠
  body.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const dy = e.deltaY * (e.deltaMode ? 16 : 1);  // 마우스 한 칸(≈100)은 한 번에 너무 커서 잘라 씀
    bvZoomTo(BV.zoom * Math.exp(-Math.max(-25, Math.min(25, dy)) * 0.01), e.clientX, e.clientY);
  }, {passive:false});
  if ('ongesturestart' in window){
    // Safari(맥 트랙패드, 아이패드 손가락·트랙패드, 아이폰): gesture 이벤트 하나로 처리
    let z0 = 1;
    body.addEventListener('gesturestart', e => { e.preventDefault(); z0 = BV.zoom; }, {passive:false});
    body.addEventListener('gesturechange', e => { e.preventDefault(); bvZoomTo(z0 * e.scale, e.clientX, e.clientY); }, {passive:false});
    body.addEventListener('gestureend', e => { e.preventDefault(); }, {passive:false});
  } else {
    // 안드로이드·크롬 터치: 두 손가락 거리
    let d0 = 0, z0 = 1;
    const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    body.addEventListener('touchstart', e => { if (e.touches.length === 2){ d0 = dist(e.touches); z0 = BV.zoom; } }, {passive:true});
    body.addEventListener('touchmove', e => {
      if (e.touches.length !== 2 || !d0) return;
      e.preventDefault();
      bvZoomTo(z0 * dist(e.touches) / d0, (e.touches[0].clientX + e.touches[1].clientX) / 2, (e.touches[0].clientY + e.touches[1].clientY) / 2);
    }, {passive:false});
    body.addEventListener('touchend', e => { if (e.touches.length < 2) d0 = 0; }, {passive:true});
  }
  // 더블클릭·두 번 탭: 100% ↔ 200%
  body.addEventListener('dblclick', e => { e.preventDefault(); bvZoomTo(BV.zoom > 1.05 ? 1 : 2, e.clientX, e.clientY); });
  // 마우스로 끌어서 이동 (확대했을 때)
  let drag = null;
  body.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse' || e.button !== 0) return; drag = {x:e.clientX, y:e.clientY, l:body.scrollLeft, t:body.scrollTop}; body.style.cursor = 'grabbing'; });
  addEventListener('pointermove', e => { if (!drag) return; body.scrollLeft = drag.l - (e.clientX - drag.x); body.scrollTop = drag.t - (e.clientY - drag.y); });
  addEventListener('pointerup', () => { if (drag){ drag = null; body.style.cursor = ''; } });
}
'''
h = rep(h, "function bvRefsBox(q){", ZOOM.strip() + "\nfunction bvRefsBox(q){")
# 쪽이 바뀌면 확대 표시 갱신
h = rep(h, "    prev.disabled = BV.page <= 1; next.disabled = BV.page >= BV.n;",
        "    prev.disabled = BV.page <= 1; next.disabled = BV.page >= BV.n;\n    { const zl = document.getElementById('bvZ'); if (zl) zl.textContent = Math.round(BV.zoom * 100) + '%'; }")
# 창 안에서는 페이지 전체 확대(브라우저 기본 핀치)가 일어나지 않게
h = rep(h, "#bvPanel .bvB{flex:1;min-height:0;overflow:auto;", "#bvPanel .bvB{flex:1;min-height:0;overflow:auto;cursor:grab;user-select:none;-webkit-user-select:none;")
open(out, 'w', encoding='utf-8').write(h)
print('ok', len(h), 'decks', len(D))
