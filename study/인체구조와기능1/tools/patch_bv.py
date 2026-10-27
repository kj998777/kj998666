"""📖 교재·PPT 옆에 보기: 해설에 붙은 근거 페이지(국소해부학·길라잡이·그란트·골학·김정태p PPT·발표 캡처)를
문제 화면을 가리지 않는 작은 창(넓은 화면은 오른쪽, 좁은 화면은 아래)에 띄우고, 그 쪽부터 앞뒤로 넘겨 볼 수 있게 한다.

usage: python3 -I patch_bv.py <live page.html (wrapper 벗긴 것)> <out.html>
"""
import sys
src, out = sys.argv[1:3]
h = open(src, encoding='utf-8').read()

def rep(s, old, new):
    assert s.count(old) == 1, (s.count(old), old[:80])
    return s.replace(old, new)

if 'id="bvCss"' in h or 'function bvOpen' in h:
    raise SystemExit('already patched')

CSS = r'''
#bvPanel{position:fixed;z-index:985;background:var(--surface);display:none;flex-direction:column;border:1px solid var(--line);box-shadow:-6px 0 24px rgba(0,0,0,.10)}
#bvPanel.wide{right:0;top:env(safe-area-inset-top,0px);bottom:env(safe-area-inset-bottom,0px);width:460px;border-width:0 0 0 1px}
#bvPanel.narrow{left:0;right:0;bottom:0;height:52vh;border-radius:14px 14px 0 0;border-width:1px 0 0;box-shadow:0 -6px 24px rgba(0,0,0,.12);padding-bottom:env(safe-area-inset-bottom,0px)}
#bvPanel .bvH{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid var(--line)}
#bvPanel .bvT{flex:1;min-width:0;font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#bvPanel .bvX{border:1px solid var(--line);background:var(--surface);border-radius:8px;min-width:32px;height:32px;font-size:15px;color:var(--ink2)}
#bvPanel .bvChips{display:flex;gap:6px;overflow-x:auto;padding:8px 10px;border-bottom:1px solid var(--line);scrollbar-width:thin}
#bvPanel .bvChip{flex:none;border:1px solid var(--line);background:var(--surface);border-radius:999px;padding:4px 10px;font-size:12.5px;color:var(--ink2);white-space:nowrap}
#bvPanel .bvChip.on{background:var(--accent);border-color:var(--accent);color:var(--accent-ink);font-weight:500}
#bvPanel .bvB{flex:1;min-height:0;overflow:auto;background:var(--surface2);padding:8px;-webkit-overflow-scrolling:touch}
#bvPanel .bvB canvas,#bvPanel .bvB img{display:block;margin:0 auto;background:#fff;border-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,.12)}
#bvPanel .bvMsg{font-size:13.5px;color:var(--ink2);padding:10px 6px;line-height:1.6}
#bvPanel .bvF{display:flex;align-items:center;gap:6px;padding:8px 10px;border-top:1px solid var(--line);font-size:13px;color:var(--ink2);font-variant-numeric:tabular-nums}
#bvPanel .bvF .sp{flex:1}
#bvPanel .bvF input{width:56px;border:1px solid var(--line);border-radius:8px;padding:4px 6px;font-size:14px;text-align:center;background:var(--surface)}
#bvPill{position:fixed;z-index:984;left:calc(env(safe-area-inset-left,0px) + 14px);bottom:calc(env(safe-area-inset-bottom,0px) + 14px);display:none;box-shadow:0 4px 16px rgba(0,0,0,.18);border-radius:999px}
.bvRefs{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:10px;font-size:12.5px;color:var(--ink3)}
.bvRefs button{border:1px solid var(--line);background:var(--surface);border-radius:999px;padding:4px 10px;font-size:12.5px;color:var(--ink2)}
.bvRefs button:hover{border-color:var(--accent);color:var(--accent)}
.pxfig img{cursor:zoom-in}
'''

JS = r'''
/* ---- 📖 교재·PPT 옆에 보기 ----
   해설 근거 페이지를 문제를 가리지 않는 작은 창에 띄움: 넓은 화면(≥1100px)은 오른쪽 460px에 붙고(문제는 왼쪽으로 비킴),
   좁은 화면(아이패드 세로·폰)은 아래 52% 시트(문제 아래쪽에 그만큼 여백). 교재 PDF는 추가 공부 PDF와 같은 연결 파일(이 기기)을 씀. */
const KJT_BOOK = {os:'KO', l1:'K1', l2:'K2', l3:'K3', l4:'K4', tc:'KT', hl:'KH'};
function bvSources(q){
  const out = [];
  for (const r of refsOf(q)) out.push({kind:'pdf', b:r.b, p:pdfPageOf(r), label:refLabel(r)});
  for (const x of (q.xi || [])){
    const m = /^kjt-(\w+)-(\d+)\.jpg$/.exec(x.f);
    if (m && KJT_BOOK[m[1]]) out.push({kind:'pdf', b:KJT_BOOK[m[1]], p:+m[2], img:'pimg/' + x.f, label:x.cap});
    else out.push({kind:'img', img:'pimg/' + x.f, label:x.cap});
  }
  const seen = new Set();
  return out.filter(s => { const k = s.kind === 'pdf' ? s.b + ':' + s.p : s.img; if (seen.has(k)) return false; seen.add(k); return true; });
}
let bvLibP = null;   // 보기만 할 때는 pdf.js만 (jsPDF는 PDF 묶기에서만)
function bvLib(){
  if (window.pdfjsLib) return Promise.resolve();
  if (!bvLibP) bvLibP = (async () => { await loadScript(LIBS.pdfjs); await loadScript(LIBS.worker); window.pdfjsLib.GlobalWorkerOptions.workerSrc = LIBS.worker; })().catch(e => { bvLibP = null; throw e; });
  return bvLibP;
}
const BV = {q:null, list:[], i:0, page:0, n:0, zoom:1, open:false, min:false, tok:0, linked:false};
const bvWide = () => window.innerWidth >= 1100;
function bvPanel(){
  let p = document.getElementById('bvPanel'); if (p) return p;
  p = el('div', {id:'bvPanel', role:'dialog', 'aria-label':'교재·PPT 보기'},
    el('div', {class:'bvH'},
      el('span', {class:'bvT', id:'bvT'}, '교재·PPT'),
      el('button', {type:'button', class:'bvX', title:'작게 접기', 'aria-label':'작게 접기', onclick: () => bvMin(true)}, '–'),
      el('button', {type:'button', class:'bvX', title:'닫기', 'aria-label':'닫기', onclick: bvClose}, '×')),
    el('div', {class:'bvChips', id:'bvChips'}),
    el('div', {class:'bvB', id:'bvB'}),
    el('div', {class:'bvF'},
      el('button', {type:'button', class:'btn sm', id:'bvPrev', onclick: () => bvStep(-1)}, '◀'),
      el('span', {id:'bvPg'}),
      el('button', {type:'button', class:'btn sm', id:'bvNext', onclick: () => bvStep(1)}, '▶'),
      el('span', {class:'sp'}),
      el('button', {type:'button', class:'btn sm', title:'작게', onclick: () => { BV.zoom = Math.max(1, BV.zoom - .5); bvDraw(); }}, '－'),
      el('button', {type:'button', class:'btn sm', title:'크게', onclick: () => { BV.zoom = Math.min(3, BV.zoom + .5); bvDraw(); }}, '＋')));
  document.body.append(p);
  const pill = el('button', {id:'bvPill', type:'button', class:'btn', onclick: () => bvMin(false)}, '📖 교재 보기 펼치기');
  document.body.append(pill);
  return p;
}
function bvLayout(){
  const p = document.getElementById('bvPanel'), pill = document.getElementById('bvPill');
  const show = BV.open && !BV.min;
  if (p){
    p.className = bvWide() ? 'wide' : 'narrow';
    p.style.display = show ? 'flex' : 'none';
    const trxSide = typeof trxMode !== 'undefined' && trxMode === 'side' && typeof trxFrame !== 'undefined' && trxFrame;
    p.style.right = bvWide() && trxSide ? '440px' : '';
  }
  if (pill) pill.style.display = BV.open && BV.min ? 'inline-flex' : 'none';
  const trxSide = typeof trxMode !== 'undefined' && trxMode === 'side';
  if (show && bvWide()){ document.body.style.paddingRight = (trxSide ? 900 : 460) + 'px'; document.body.style.paddingBottom = ''; }
  else { document.body.style.paddingRight = trxSide ? '440px' : ''; document.body.style.paddingBottom = show ? '54vh' : ''; }
}
function bvMin(m){ BV.min = m; bvLayout(); if (!m) bvDraw(); }
function bvClose(){ BV.open = false; BV.min = false; bvLayout(); }
function bvOpen(q, idx){
  const list = bvSources(q); if (!list.length) return;
  BV.q = q; BV.list = list; BV.zoom = 1; BV.open = true; BV.min = false;
  bvPanel(); bvLayout(); bvGo(Math.max(0, Math.min(list.length - 1, idx || 0)));
}
// 다음 문제의 해설이 열리면 창이 떠 있을 때 그 문제의 근거로 바꿈
function bvFollow(q){ if (BV.open && BV.q !== q && bvSources(q).length) { const z = BV.zoom; bvOpen(q, 0); BV.zoom = z; BV.min = false; bvLayout(); } }
function bvGo(i){
  BV.i = i; const s = BV.list[i]; BV.page = s.kind === 'pdf' ? s.p : 0; BV.n = 0;
  const chips = document.getElementById('bvChips');
  chips.replaceChildren(...BV.list.map((x, k) => el('button', {type:'button', class:'bvChip' + (k === i ? ' on' : ''), onclick: () => bvGo(k)}, x.label)));
  chips.style.display = BV.list.length > 1 ? 'flex' : 'none';
  const on = chips.children[i]; if (on) on.scrollIntoView({block:'nearest', inline:'nearest'});
  bvDraw();
}
function bvStep(d){
  const s = BV.list[BV.i]; if (!s) return;
  if (s.kind === 'pdf' && BV.n){ const p = BV.page + d; if (p >= 1 && p <= BV.n){ BV.page = p; bvDraw(); } return; }
  const k = BV.i + d; if (k >= 0 && k < BV.list.length) bvGo(k);
}
async function bvDraw(){
  const s = BV.list[BV.i], body = document.getElementById('bvB'); if (!s || !body) return;
  const tok = ++BV.tok, W = Math.max(240, body.clientWidth - 16);
  document.getElementById('bvT').textContent = s.kind === 'pdf' ? (BOOKS[s.b] ? BOOKS[s.b].name : s.label) : s.label;
  const pg = document.getElementById('bvPg'), prev = document.getElementById('bvPrev'), next = document.getElementById('bvNext');
  const imgView = (src, note) => {
    const im = el('img', {src, alt:s.label, style:`width:${Math.round(W * BV.zoom)}px;max-width:none`});
    body.replaceChildren(...(note ? [note] : []), im);
    pg.textContent = BV.list.length > 1 ? `${BV.i + 1} / ${BV.list.length}` : '';
    prev.disabled = BV.i === 0; next.disabled = BV.i >= BV.list.length - 1;
  };
  if (s.kind === 'img'){ imgView(s.img); return; }
  if (!BV.linked){ BV.linked = true; try { await restoreLinks(); } catch(e){} }
  if (!hasSrc(s.b)){
    const inp = el('input', {type:'file', accept:'application/pdf,.pdf', multiple:true, style:'display:none', onchange: async () => {
      const files = [...inp.files]; if (!files.length) return;
      const unk = assignFiles(files); await rememberAll(Object.keys(BOOKS).filter(k => LINK[k]));
      bvDraw();
    }});
    const note = el('div', {class:'bvMsg'},
      el('div', null, `이 기기에 「${BOOKS[s.b] ? BOOKS[s.b].name : s.b}」 PDF가 연결되어 있지 않아요. 한 번 연결하면 이 기기에 기억돼서 다음부터는 바로 그 쪽이 떠요.`),
      el('div', {style:'margin-top:8px;display:flex;gap:8px;flex-wrap:wrap'}, el('button', {type:'button', class:'btn sm primary', onclick: () => inp.click()}, 'PDF 연결하기'), inp));
    if (s.img) imgView(s.img, note); else { body.replaceChildren(note); pg.textContent = ''; prev.disabled = BV.i === 0; next.disabled = BV.i >= BV.list.length - 1; }
    return;
  }
  body.replaceChildren(el('div', {class:'bvMsg'}, `${BV.page}쪽 불러오는 중…`));
  try {
    await bvLib();
    const doc = await openDoc(s.b); if (tok !== BV.tok) return;
    BV.n = doc.numPages;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const c = await renderPage(s.b, BV.page, Math.round(W * BV.zoom * dpr), BV.page === s.p && BV.q ? [hlSpec(BV.q)] : null);
    if (tok !== BV.tok) return;
    c.style.width = Math.round(W * BV.zoom) + 'px'; c.style.maxWidth = 'none';
    body.replaceChildren(c); body.scrollTop = 0;
    pg.replaceChildren(
      el('input', {type:'number', min:1, max:BV.n, value:BV.page, 'aria-label':'쪽 번호', onchange: e => { const v = +e.target.value; if (v >= 1 && v <= BV.n){ BV.page = v; bvDraw(); } }}),
      ` / ${BV.n}` + (BV.page === s.p ? ' · 해설 쪽' : ''));
    prev.disabled = BV.page <= 1; next.disabled = BV.page >= BV.n;
  } catch(e){
    if (tok !== BV.tok) return;
    body.replaceChildren(el('div', {class:'bvMsg'}, '쪽을 띄우지 못했어요: ' + ((e && e.message) || e)));
    if (s.img) imgView(s.img, el('div', {class:'bvMsg'}, 'PDF 대신 캡처를 보여 줘요.'));
  }
}
function bvRefsBox(q){
  const list = bvSources(q); if (!list.length) return null;
  return el('div', {class:'bvRefs'}, el('span', null, '📖 옆에 띄워 보기'), ...list.map((s, k) => el('button', {type:'button', onclick: () => bvOpen(q, k)}, s.label)));
}
window.addEventListener('resize', () => { if (BV.open) { bvLayout(); clearTimeout(BV.rt); BV.rt = setTimeout(bvDraw, 250); } });
document.addEventListener('keydown', e => {
  if (!BV.open || BV.min) return;
  const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
  if (e.key === 'Escape') bvClose();
  else if (e.key === '[') bvStep(-1); else if (e.key === ']') bvStep(1);
});
'''

h = rep(h, '.qtext{white-space:pre-wrap;', CSS.strip() + '\n.qtext{white-space:pre-wrap;')
# 해설: 참고 페이지 글줄 → 누르면 옆 창에 그 쪽부터 뜨는 버튼들, 슬라이드 캡처도 누르면 옆 창
h = rep(h, "    { const rs = refsOf(q); if (rs.length) box.append(el('div', {class:'note', text:'📖 참고 페이지: ' + rs.map(refLabel).join(', ')})); }",
        "    { const rb = bvRefsBox(q); if (rb) box.append(rb); bvFollow(q); }")
old = "...q.xi.map(x => el('figure', {class:'pxfig'}, el('img', {class:'pimg', src:'pimg/' + x.f, alt:x.cap, loading:'lazy'}),"
assert h.count(old) == 1, h.count(old)
h = h.replace(old, "...q.xi.map(x => el('figure', {class:'pxfig'}, el('img', {class:'pimg', src:'pimg/' + x.f, alt:x.cap, loading:'lazy', title:'누르면 옆에 크게', onclick: () => bvOpen(q, bvSources(q).findIndex(s => s.img === 'pimg/' + x.f))}),")
# 전사기를 옆에 두거나 치울 때도 자리 다시 잡기
h = rep(h, "  if (typeof m3dSplit === 'function') m3dSplit();\n  if (mode !== 'full'",
        "  if (typeof m3dSplit === 'function') m3dSplit();\n  if (typeof bvLayout === 'function' && BV.open) bvLayout();\n  if (mode !== 'full'")
h = rep(h, "/* ---- 🎙 실시간 전사 (transcriber.html", JS.strip() + "\n/* ---- 🎙 실시간 전사 (transcriber.html")
open(out, 'w', encoding='utf-8').write(h)
print('ok', len(h))
