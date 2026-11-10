"""📖 옆 창 5차: 확대 상태에서는 두 손가락으로 화면을 옮겨도 쪽이 넘어가지 않게
- 확대 안 함(가로로 다 보임): 지금처럼 두 손가락 쓸기로 바로 넘김
- 확대함(가로로 더 볼 게 있음): 옮기다가 가장자리에 닿아도 그 동작(관성 포함)으로는 안 넘어감.
  가장자리에서 손을 뗐다가 다시 같은 방향으로 길게 밀어야 넘어감. 미는 동안 '다음 쪽 ▶' 진행 표시
- 화면 터치도 같음: 확대 상태에서는 시작할 때 이미 가장자리였고, 화면이 안 움직인 채 길게(140px) 쓸었을 때만 넘김

usage: python3 -I patch_bv5.py <page.html (patch_bv4 적용본)> <out.html>
"""
import sys
src, out = sys.argv[1:3]
h = open(src, encoding='utf-8').read()

def rep(s, old, new):
    assert s.count(old) == 1, (s.count(old), old[:80])
    return s.replace(old, new)

if 'bvEdge' in h:
    raise SystemExit('already patched')

h = rep(h, "#bvPanel .bvH{",
        "#bvPanel .bvEdge{position:absolute;top:50%;z-index:4;transform:translateY(-50%);display:none;padding:7px 13px;border-radius:999px;border:1px solid var(--accent);color:var(--ink);font-size:12.5px;font-weight:500;white-space:nowrap;box-shadow:0 2px 10px rgba(0,0,0,.15);pointer-events:none;"
        "background:linear-gradient(90deg,var(--accent-soft) calc(var(--p,0)*100%),var(--surface) 0)}\n"
        "#bvPanel .bvH{")

h = rep(h, """    // 확대해서 가로로 더 볼 게 있으면 그 방향 끝에 닿을 때까지는 화면 이동
    const max = body.scrollWidth - body.clientWidth;
    if (max > 1 && ((dx > 0 && body.scrollLeft < max - 1) || (dx < 0 && body.scrollLeft > 1))) { acc = 0; return; }
    e.preventDefault();""",
"""    // 확대해서 가로로 더 볼 게 있으면: 옮기기 우선, 가장자리에서 '새로' 길게 밀 때만 넘김
    const max = body.scrollWidth - body.clientWidth;
    if (max > 1){ bvEdgePull(e, dx, max); acc = 0; return; }
    e.preventDefault();""")
h = rep(h, "  body.addEventListener('wheel', e => {\n    if (e.ctrlKey || e.metaKey) return;\n    const dx = e.deltaX",
        "  body.addEventListener('wheel', e => {\n    if (e.ctrlKey || e.metaKey) return;\n    if (body.scrollWidth - body.clientWidth > 1){ zTouch(); if (Math.abs(e.deltaY) > 4 && Math.abs(e.deltaY) > Math.abs(e.deltaX)) zg.moved = true; }\n    const dx = e.deltaX")

EDGE = r'''
  // 확대 상태 트랙패드: 한 동작(손 댄 뒤 관성까지, 180ms 쉬면 끝)에 화면이 움직였으면 그 동작으로는 안 넘김
  const ind = el('div', {class:'bvEdge'}); body.parentElement.append(ind);
  const PULL = 180;
  let zg = {moved:false, pull:0}, zIdle = 0;
  const zEnd = () => { zg = {moved:false, pull:0}; ind.style.display = 'none'; };
  const zTouch = () => { clearTimeout(zIdle); zIdle = setTimeout(zEnd, 180); };
  const bvEdgePull = (e, dx, max) => {
    if (zg.flipped){ e.preventDefault(); return; }   // 넘긴 뒤 남은 밀기·관성은 새 쪽을 옮기지 않게 버림
    const atEdge = dx > 0 ? body.scrollLeft >= max - 1 : body.scrollLeft <= 1;
    if (!atEdge){ zg.moved = true; zg.pull = 0; ind.style.display = 'none'; return; }   // 그냥 화면 옮기기
    e.preventDefault();                       // 가장자리: 브라우저 '뒤로 가기' 막기
    if (zg.moved) return;                     // 옮기다 닿은 것 → 손 떼고 다시 밀어야 함
    if (Math.sign(dx) !== Math.sign(zg.pull)) zg.pull = 0;
    zg.pull += dx;
    const d = zg.pull > 0 ? 1 : -1, can = d > 0 ? BV.page < BV.n || BV.i < BV.list.length - 1 : BV.page > 1 || BV.i > 0;
    if (!can){ ind.style.display = 'none'; return; }
    const p = Math.min(1, Math.abs(zg.pull) / PULL);
    ind.textContent = d > 0 ? '계속 밀면 다음 쪽 ▶' : '◀ 계속 밀면 이전 쪽';
    ind.style.setProperty('--p', p); ind.style.display = 'block';
    ind.style.left = d > 0 ? '' : '12px'; ind.style.right = d > 0 ? '12px' : '';
    if (p >= 1){ zg.moved = zg.flipped = true; zg.pull = 0; ind.style.display = 'none'; bvSwipe(d); }
  };
'''
h = rep(h, "  let acc = 0, lock = false, idle = 0, prev = 0, rise = 0, flipT = 0;",
        EDGE.strip('\n') + "\n  let acc = 0, lock = false, idle = 0, prev = 0, rise = 0, flipT = 0;")

# 화면 터치: 시작할 때 가로 위치·가장자리 기억
h = rep(h, "  body.addEventListener('touchstart', e => { sw = e.touches.length === 2 ? {m:mid(e.touches), g:gap(e.touches), last:null, z:BV.zoom} : (e.touches.length > 2 ? null : sw); }, {passive:true});",
        "  body.addEventListener('touchstart', e => { sw = e.touches.length === 2 ? {m:mid(e.touches), g:gap(e.touches), last:null, z:BV.zoom, sl:body.scrollLeft, max:body.scrollWidth - body.clientWidth} : (e.touches.length > 2 ? null : sw); }, {passive:true});")
h = rep(h, """    if (Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy) && r > .8 && r < 1.25){""",
"""    // 확대 상태: 시작부터 그 방향 가장자리였고, 화면이 안 움직였고, 길게 쓸었을 때만
    const zoomed = s.max > 1, edgeOk = !zoomed || ((dx < 0 ? s.sl >= s.max - 1 : s.sl <= 1) && Math.abs(body.scrollLeft - s.sl) < 3 && Math.abs(dx) > 140);
    if (edgeOk && Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy) && r > .8 && r < 1.25){""")
open(out, 'w', encoding='utf-8').write(h)
print('ok', len(h))
