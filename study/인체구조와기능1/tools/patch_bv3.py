"""📖 옆 창 3차: 두 손가락 좌우 쓸기로 쪽 넘기기 + 창 크기(가로 PPT는 저절로 넓게, 손잡이로 조절)
- 트랙패드(맥·윈도·아이패드 트랙패드): 가로 휠 이벤트. 확대해서 옆으로 더 갈 곳이 있으면 먼저 화면을 옮기고, 끝에 닿은 뒤에 쓸면 넘어감
- 아이패드·폰 화면: 두 손가락을 벌리거나 모으지 않고 좌우로 쓸면 넘어감(한 손가락은 그대로 화면 이동)

usage: python3 -I patch_bv3.py <page.html (patch_bv2 적용본)> <out.html>
"""
import sys
src, out = sys.argv[1:3]
h = open(src, encoding='utf-8').read()

def rep(s, old, new):
    assert s.count(old) == 1, (s.count(old), old[:80])
    return s.replace(old, new)

if 'bvSwipe' in h:
    raise SystemExit('already patched')

SWIPE = r'''
  // 두 손가락 좌우 쓸기 → 쪽 넘기기 (왼쪽으로 쓸면 다음 쪽)
  const bvSwipe = d => { bvStep(d); const t = body.querySelector('canvas,img'); if (t && t.animate) t.animate([{transform:`translateX(${-d * 24}px)`, opacity:.4}, {transform:'none', opacity:1}], {duration:180, easing:'ease-out'}); };
  let acc = 0, lock = false, idle = 0;
  body.addEventListener('wheel', e => {
    if (e.ctrlKey || e.metaKey) return;
    const dx = e.deltaX * (e.deltaMode ? 16 : 1), dy = e.deltaY * (e.deltaMode ? 16 : 1);
    if (Math.abs(dx) <= Math.abs(dy)) return;
    // 확대해서 가로로 더 볼 게 있으면 그 방향 끝에 닿을 때까지는 화면 이동
    const max = body.scrollWidth - body.clientWidth;
    if (max > 1 && ((dx > 0 && body.scrollLeft < max - 1) || (dx < 0 && body.scrollLeft > 1))) { acc = 0; return; }
    e.preventDefault();                       // 브라우저 '뒤로 가기' 쓸기 막기
    clearTimeout(idle); idle = setTimeout(() => { acc = 0; lock = false; }, 220);  // 관성 스크롤이 끝나야 다음 넘김
    if (lock) return;
    acc += dx;
    if (Math.abs(acc) > 90){ lock = true; bvSwipe(acc > 0 ? 1 : -1); acc = 0; }
  }, {passive:false});
  let sw = null;
  const mid = t => [(t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2];
  const gap = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  body.addEventListener('touchstart', e => { sw = e.touches.length === 2 ? {m:mid(e.touches), g:gap(e.touches), last:null, z:BV.zoom} : (e.touches.length > 2 ? null : sw); }, {passive:true});
  body.addEventListener('touchmove', e => { if (sw && e.touches.length === 2) sw.last = {m:mid(e.touches), g:gap(e.touches)}; }, {passive:true});
  body.addEventListener('touchend', () => {
    if (!sw) return; const s = sw; sw = null; if (!s.last) return;
    const dx = s.last.m[0] - s.m[0], dy = s.last.m[1] - s.m[1], r = s.last.g / s.g;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy) && r > .8 && r < 1.25){
      if (Math.abs(BV.zoom - s.z) > .01) bvZoomTo(s.z);   // 쓸다가 살짝 바뀐 확대 되돌리기
      bvSwipe(dx < 0 ? 1 : -1);
    }
  }, {passive:true});
'''
h = rep(h, "  addEventListener('pointerup', () => { if (drag){ drag = null; body.style.cursor = ''; } });\n}",
        "  addEventListener('pointerup', () => { if (drag){ drag = null; body.style.cursor = ''; } });" + SWIPE.rstrip() + "\n}")
# 핀치는 손가락 간격이 8% 넘게 바뀐 뒤부터 확대 — 두 손가락으로 쓸 때 화면이 흔들리지 않게
h = rep(h, "body.addEventListener('gesturechange', e => { e.preventDefault(); bvZoomTo(z0 * e.scale, e.clientX, e.clientY); }, {passive:false});",
        "body.addEventListener('gesturechange', e => { e.preventDefault(); if (Math.abs(e.scale - 1) > .08) bvZoomTo(z0 * e.scale, e.clientX, e.clientY); }, {passive:false});")
h = rep(h, "      bvZoomTo(z0 * dist(e.touches) / d0,",
        "      const r = dist(e.touches) / d0; if (Math.abs(r - 1) <= .08) return;\n      bvZoomTo(z0 * r,")

# ── 창 크기: 가로로 긴 PPT 쪽이면 저절로 넓게(좁은 화면은 낮게), 가장자리 손잡이를 끌어 직접 조절, 크기는 이 기기에 기억 ──
h = rep(h, "#bvPanel .bvH{", "#bvPanel .bvGrip{position:absolute;z-index:3;touch-action:none}\n"
        "#bvPanel.wide .bvGrip{left:-7px;top:0;bottom:0;width:14px;cursor:ew-resize}\n"
        "#bvPanel.narrow .bvGrip{left:0;right:0;top:0;height:16px;cursor:ns-resize}\n"
        "#bvPanel .bvGrip::after{content:'';position:absolute;background:var(--ink3);opacity:.45;border-radius:3px}\n"
        "#bvPanel.wide .bvGrip::after{left:5px;top:50%;width:4px;height:44px;margin-top:-22px}\n"
        "#bvPanel.narrow .bvGrip::after{top:5px;left:50%;width:44px;height:4px;margin-left:-22px}\n"
        "#bvPanel .bvGrip:hover::after,#bvPanel .bvGrip.on::after{background:var(--accent);opacity:1}\n"
        "#bvPanel.narrow .bvH{padding-top:14px}\n"
        "#bvPanel .bvH{")
h = rep(h, "      el('button', {type:'button', class:'bvX', title:'작게 접기', 'aria-label':'작게 접기', onclick: () => bvMin(true)}, '–'),",
        "      el('button', {type:'button', class:'bvX', id:'bvBig', title:'창 크게 / 원래대로', 'aria-label':'창 크게 / 원래대로', onclick: bvBig}, '⤢'),\n"
        "      el('button', {type:'button', class:'bvX', title:'작게 접기', 'aria-label':'작게 접기', onclick: () => bvMin(true)}, '–'),")
h = rep(h, "  bvGestures(p.querySelector('.bvB'));\n  document.body.append(p);",
        "  bvGestures(p.querySelector('.bvB'));\n  p.prepend(bvGrip());\n  document.body.append(p);")
h = rep(h, "const BV = {q:null, list:[], i:0, page:0, n:0, zoom:1, open:false, min:false, tok:0, linked:false};",
        "const BV = {q:null, list:[], i:0, page:0, n:0, zoom:1, open:false, min:false, tok:0, linked:false, land:false, sz:(() => { try { return JSON.parse(localStorage.getItem('bv.size')) || {}; } catch(e){ return {}; } })()};")

SIZE = r'''
/* 창 크기. 넓은 화면은 너비, 좁은 화면은 높이. 세로 쪽(교재)·가로 쪽(PPT)을 따로 기억 */
const bvTrxSide = () => typeof trxMode !== 'undefined' && trxMode === 'side';
function bvDims(){
  const k = BV.land ? 'l' : 'p', s = BV.sz[k] || {}, W = window.innerWidth, H = window.innerHeight;
  const maxW = Math.max(320, W - (bvTrxSide() ? 440 : 0) - 360);
  const w = Math.round(Math.max(320, Math.min(maxW, s.w || (BV.land ? Math.max(560, Math.min(960, W * .5)) : 460))));
  const h = Math.round(Math.max(180, Math.min(H * .9, s.h || (BV.land ? Math.min(H * .52, W * .5625 + 150) : H * .52))));
  return {w, h};
}
function bvSaveSize(o){
  const k = BV.land ? 'l' : 'p';
  if (o) BV.sz[k] = Object.assign({}, BV.sz[k], o); else delete BV.sz[k];
  try { localStorage.setItem('bv.size', JSON.stringify(BV.sz)); } catch(e){}
}
// 쪽 모양이 바뀌면(세로 ↔ 가로) 창 크기를 다시 잡음. 바뀌었으면 true
function bvAspect(w, h){
  const land = w > h * 1.15; if (land === BV.land) return false;
  BV.land = land; bvLayout(); return true;
}
function bvBig(){
  const d = bvDims(), k = BV.land ? 'l' : 'p';
  if (bvWide()){ const big = Math.round(window.innerWidth * .68); if (d.w < big - 20) bvSaveSize({w: big}); else bvSaveSize(null); }
  else { const big = Math.round(window.innerHeight * .85); if (d.h < big - 20) bvSaveSize({h: big}); else bvSaveSize(null); }
  bvLayout(); bvDraw(true);
}
function bvGrip(){
  const g = el('div', {class:'bvGrip', title:'끌어서 창 크기 조절 · 두 번 누르면 원래대로', 'aria-hidden':'true'});
  let st = null;
  g.addEventListener('pointerdown', e => {
    e.preventDefault(); g.setPointerCapture(e.pointerId); g.classList.add('on');
    const d = bvDims(); st = {x:e.clientX, y:e.clientY, w:d.w, h:d.h};
  });
  g.addEventListener('pointermove', e => {
    if (!st) return;
    if (bvWide()) bvSaveSize({w: st.w + (st.x - e.clientX)}); else bvSaveSize({h: st.h + (st.y - e.clientY)});
    bvLayout();
  });
  const end = () => { if (!st) return; st = null; g.classList.remove('on'); const d = bvDims(); bvSaveSize(bvWide() ? {w:d.w} : {h:d.h}); bvDraw(true); };
  g.addEventListener('pointerup', end); g.addEventListener('pointercancel', end);
  g.addEventListener('dblclick', () => { bvSaveSize(null); bvLayout(); bvDraw(true); });
  return g;
}
'''
h = rep(h, "function bvLayout(){", SIZE.strip() + "\nfunction bvLayout(){")
h = rep(h, "    p.style.right = bvWide() && trxSide ? '440px' : '';\n  }",
        "    p.style.right = bvWide() && trxSide ? '440px' : '';\n"
        "    const d = bvDims(); p.style.width = bvWide() ? d.w + 'px' : ''; p.style.height = bvWide() ? '' : d.h + 'px';\n"
        "    const big = document.getElementById('bvBig'); if (big) big.textContent = (bvWide() ? d.w > window.innerWidth * .6 : d.h > window.innerHeight * .8) ? '⤡' : '⤢';\n  }")
h = rep(h, "  if (show && bvWide()){ document.body.style.paddingRight = (trxSide ? 900 : 460) + 'px'; document.body.style.paddingBottom = ''; }\n"
           "  else { document.body.style.paddingRight = trxSide ? '440px' : ''; document.body.style.paddingBottom = show ? '54vh' : ''; }",
        "  const dd = bvDims();\n"
        "  if (show && bvWide()){ document.body.style.paddingRight = (trxSide ? 440 : 0) + dd.w + 'px'; document.body.style.paddingBottom = ''; }\n"
        "  else { document.body.style.paddingRight = trxSide ? '440px' : ''; document.body.style.paddingBottom = show ? dd.h + 16 + 'px' : ''; }")
# 그리기 전에 쪽 모양을 보고 창 크기부터 맞춤
h = rep(h, "  const tok = ++BV.tok, W = Math.max(240, body.clientWidth - 16);",
        "  const tok = ++BV.tok; let W = Math.max(240, body.clientWidth - 16);")
h = rep(h, "    BV.n = doc.numPages;\n",
        "    BV.n = doc.numPages;\n"
        "    { const v = (await doc.getPage(BV.page)).getViewport({scale:1}); if (tok !== BV.tok) return; if (bvAspect(v.width, v.height)) W = Math.max(240, body.clientWidth - 16); }\n")
h = rep(h, "    const im = el('img', {src, alt:s.label, style:`width:${Math.round(W * BV.zoom)}px;max-width:none`});",
        "    const im = el('img', {src, alt:s.label, style:`width:${Math.round(W * BV.zoom)}px;max-width:none`});\n"
        "    im.onload = () => { if (tok === BV.tok && bvAspect(im.naturalWidth, im.naturalHeight)) bvDraw(true); };")
open(out, 'w', encoding='utf-8').write(h)
print('ok', len(h))
