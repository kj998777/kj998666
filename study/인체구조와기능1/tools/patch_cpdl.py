"""채점기: 🖊 수업 PDF로 열 때 학생발표 원본이 이 컴퓨터에 없으면 먼저 받아 두기

이 기기에서 그 발표를 처음 열 때만, 채점기 자료 저장소의 원본 PDF를 드라이브 원래 이름으로
다운로드 폴더에 저장(확인 창 한 번)한 뒤 수업 PDF 링크를 연다. 받은 발표는 브라우저에 기억해 다음부터는 바로 연다.
Shift를 누른 채 누르면 다시 받는다. 저장 확인을 누르는 사이 클릭 효과가 사라져 링크가 안 열릴 수 있으므로
「수업 PDF로 열기」 버튼이 있는 알림도 띄운다.

usage: python3 -I patch_cpdl.py <page.html> <out.html>
"""
import sys
src, out = sys.argv[1:3]
h = open(src, encoding='utf-8').read()

def rep(old, new):
    global h
    assert h.count(old) == 1, (h.count(old), old[:90])
    h = h.replace(old, new)

rep("""function cpOpen(url){
  let w = null;""",
"""const LS_CPDL = 'jbmid.cpdl';   // 이 기기에서 받아 둔 학생발표 원본(KJW-<id>)
function cpToast(msg, url){
  const old = document.getElementById('cpToast'); if (old) old.remove();
  const t = el('div', {id:'cpToast', style:'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.18);padding:10px 12px;display:flex;gap:8px;align-items:center;font-size:13.5px;max-width:calc(100vw - 32px)'},
    el('span', null, msg),
    url ? el('button', {class:'btn sm primary', onclick: () => { t.remove(); cpOpenNow(url); }}, '🖊 수업 PDF로 열기') : null,
    el('button', {class:'btn sm ghost', onclick: () => t.remove()}, '닫기'));
  document.body.append(t); setTimeout(() => t.remove(), 20000);
}
async function cpOpen(url, ev){
  let p; try { p = new URL(url).searchParams; } catch(e){ return cpOpenNow(url); }
  const b = p.get('b') || '', src = p.get('u');
  if (!b.startsWith('KJW-') || !src) return cpOpenNow(url);
  const got = lsGet(LS_CPDL) || {};
  if (got[b] && !(ev && ev.shiftKey)) return cpOpenNow(url);
  const dl = window.claude && window.claude.use ? await window.claude.use('downloads').catch(() => null) : null;
  if (!dl) return cpOpenNow(url);
  cpToast('발표 원본을 받는 중…');
  try {
    const r = await fetch(src); if (!r.ok) throw 0;
    const blob = await r.blob();
    await dl.save({filename: (p.get('n') || '학생발표').replace(/\\.pdf$/i, '') + '.pdf', data: blob});
    got[b] = Date.now(); lsSet(LS_CPDL, got);
    cpToast('다운로드 폴더에 받았어요. 수업 PDF에서 열어요.', url);
    setTimeout(() => cpOpenNow(url), 1500);
  } catch(e) {
    cpToast(e && e.code === 'declined' ? '받지 않았어요. 이미 있으면 그대로 열어요.' : '원본을 받지 못했어요. 이미 있으면 그대로 열어요.', url);
  }
}
function cpOpenNow(url){
  let w = null;""")
# 클릭 이벤트를 넘겨 Shift(다시 받기)를 알 수 있게
rep("onclick: () => cpOpen(link)}, '🖊')", "onclick: ev => cpOpen(link, ev)}, '🖊')")
rep("onclick: () => cpOpen(cp[k])}, s.label)", "onclick: ev => cpOpen(cp[k], ev)}, s.label)")
assert "cpOpen(" not in h.replace("cpOpen(link, ev)", "").replace("cpOpen(cp[k], ev)", "").replace("async function cpOpen(", ""), 'other cpOpen callers'
open(out, 'w', encoding='utf-8').write(h)
print('ok')
