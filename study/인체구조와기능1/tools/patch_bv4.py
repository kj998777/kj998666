"""📖 옆 창 4차: 연달아 넘길 때 빠르게
① 트랙패드: 관성 스크롤이 다 멈출 때까지 기다리지 않고, 관성(줄어드는 움직임) 중에 새로 쓸기(다시 커지는 움직임)가 오면 바로 다음 넘김
② 지금 쪽을 그린 뒤 앞뒤 쪽을 미리 그려 두어 넘기면 바로 뜸(최근 8장 기억)

usage: python3 -I patch_bv4.py <page.html (patch_bv3 적용본)> <out.html>
"""
import sys
src, out = sys.argv[1:3]
h = open(src, encoding='utf-8').read()

def rep(s, old, new):
    assert s.count(old) == 1, (s.count(old), old[:80])
    return s.replace(old, new)

if 'bvRender' in h:
    raise SystemExit('already patched')

# ① 관성 구분: 넘긴 뒤 움직임이 계속 줄어들면 관성, 120ms 넘게 멈추거나 다시 커지면 새 쓸기
h = rep(h, "  let acc = 0, lock = false, idle = 0;", "  let acc = 0, lock = false, idle = 0, prev = 0, rise = 0, flipT = 0;")
h = rep(h, """    clearTimeout(idle); idle = setTimeout(() => { acc = 0; lock = false; }, 220);  // 관성 스크롤이 끝나야 다음 넘김
    if (lock) return;
    acc += dx;
    if (Math.abs(acc) > 90){ lock = true; bvSwipe(acc > 0 ? 1 : -1); acc = 0; }""",
"""    clearTimeout(idle); idle = setTimeout(() => { acc = 0; lock = false; prev = 0; }, 120);
    const a = Math.abs(dx);
    if (lock){
      // 관성은 점점 줄어듦 — 두 번 연달아 커지면(또는 방향이 바뀌면) 손가락을 다시 댄 것
      rise = a > prev + 2 ? rise + 1 : 0;
      const flip = Math.sign(dx) !== Math.sign(acc || dx);
      prev = a;
      if (performance.now() - flipT > 120 && (rise >= 2 || (flip && a > 4))){ lock = false; acc = 0; rise = 0; }
      else return;
    }
    prev = a; acc += dx;
    if (Math.abs(acc) > 60){ lock = true; flipT = performance.now(); bvSwipe(acc > 0 ? 1 : -1); acc = Math.sign(acc); rise = 0; }""")

# ② 미리 그리기: 같은 자료·쪽·폭·강조 여부면 다시 쓰고, 앞뒤 쪽은 쉬는 틈에 그려 둠
CACHE = r'''
const BVC = new Map();
function bvRender(s, n, w){
  const hl = n === s.p && BV.q ? 1 : 0, k = `${s.b}|${n}|${w}|${hl}|${BV.q ? BV.q.id : ''}`;
  if (BVC.has(k)){ const v = BVC.get(k); BVC.delete(k); BVC.set(k, v); return v; }
  const v = renderPage(s.b, n, w, hl ? [hlSpec(BV.q)] : null);
  v.catch(() => BVC.delete(k));
  BVC.set(k, v); while (BVC.size > 8) BVC.delete(BVC.keys().next().value);
  return v;
}
function bvPrefetch(s, w){
  const tok = BV.tok, go = async () => {
    for (const d of [1, -1, 2]){
      const n = BV.page + d; if (tok !== BV.tok) return;
      if (n >= 1 && n <= BV.n) { try { await bvRender(s, n, w); } catch(e){} }
    }
  };
  (window.requestIdleCallback || (f => setTimeout(f, 60)))(go);
}
'''
h = rep(h, "async function bvDraw(keep){", CACHE.strip() + "\nasync function bvDraw(keep){")
h = rep(h, "    const c = await renderPage(s.b, BV.page, Math.round(W * BV.zoom * dpr), BV.page === s.p && BV.q ? [hlSpec(BV.q)] : null);",
        "    const rw = Math.round(W * BV.zoom * dpr), c = await bvRender(s, BV.page, rw); c.style.opacity = '';")
h = rep(h, "    { const zl = document.getElementById('bvZ'); if (zl) zl.textContent = Math.round(BV.zoom * 100) + '%'; }\n",
        "    { const zl = document.getElementById('bvZ'); if (zl) zl.textContent = Math.round(BV.zoom * 100) + '%'; }\n    bvPrefetch(s, rw);\n")
# 아직 안 그려진 쪽으로 넘길 때는 이전 그림을 흐리게 두고 위에 쪽 번호만 띄움(화면이 하얗게 깜빡이지 않게)
h = rep(h, "  if (!keep) body.replaceChildren(el('div', {class:'bvMsg'}, `${BV.page}쪽 불러오는 중…`));",
        "  if (!keep){ const old = body.querySelector('canvas'); if (old) old.style.opacity = '.35'; else body.replaceChildren(el('div', {class:'bvMsg'}, `${BV.page}쪽 불러오는 중…`)); }\n"
        "  { const pi = document.querySelector('#bvPg input'); if (pi) pi.value = BV.page; }")
open(out, 'w', encoding='utf-8').write(h)
print('ok', len(h))
