"""채점기: 문제 순서 무작위·보기 섞기가 기대대로 안 되던 곳 고치기

- 「오늘 할 일」 시작 버튼이 아래 풀이 방식(무작위 등)을 그 할 일의 방식으로 덮어쓰고 그대로 저장하던 것 → 그 한 번만 쓰고 되돌림
- 안 푼 문제·틀림·모름만·오늘 복습·틀린 횟수에도 「🔀 섞어서」를 켜면 순서를 무작위로
- 교수님별 상자의 「무작위」: 상자를 그릴 때 한 번만 섞어서 다시 시작해도 같은 순서 → 시작할 때마다 새로 섞음
- 보기 섞기: 5지선다만 섞던 것을 4지선다 등 보기 수와 같은 번호가 차례로 있는 문제까지

usage: python3 -I patch_mix2.py <page.html> <out.html>
"""
import sys
src, out = sys.argv[1:3]
h = open(src, encoding='utf-8').read()

def rep(old, new):
    global h
    assert h.count(old) == 1, (h.count(old), old[:90])
    h = h.replace(old, new)

# 1) 오늘 할 일: 방식은 그 한 번만
rep("""  prefs.mode = mode; if (wmin) prefs.wmin = wmin; lsSet(LS_KEY, snapshot());
  renderHome();
  const n = poolFor(mode).length;
  if (!n) { $('#selinfo').textContent = mode === 'due' ? '오늘 복습할 문제가 없어요 — 아직 푼 문제가 적거나 다 맞혔어요.' : '이 조건에 맞는 문제가 없어요.'; return; }
  $('#startBtn').click();""",
"""  const keep = [prefs.mode, prefs.wmin];   // 할 일의 방식은 이번 한 번만 — 내가 고른 풀이 방식(무작위 등)은 그대로 둠
  prefs.mode = mode; if (wmin) prefs.wmin = wmin;
  const n = poolFor(mode).length;
  if (n) $('#startBtn').click();
  [prefs.mode, prefs.wmin] = keep; lsSet(LS_KEY, snapshot());
  renderHome();
  if (!n) $('#selinfo').textContent = mode === 'due' ? '오늘 복습할 문제가 없어요 — 아직 푼 문제가 적거나 다 맞혔어요.' : '이 조건에 맞는 문제가 없어요.';""")

# 2) 거른 방식에도 섞어서
rep("""          <button data-mode="wcount">틀린 횟수</button>
        </div>""",
"""          <button data-mode="wcount">틀린 횟수</button>
          <button id="qshuf" class="hidden" title="안 푼 문제·틀림·모름만·오늘 복습·틀린 횟수로 거른 문제를 무작위 순서로">🔀 섞어서</button>
        </div>""")
rep("""$('#modes').addEventListener('click', ev => {
  const b = ev.target.closest('button'); if (!b) return;""",
"""$('#modes').addEventListener('click', ev => {
  const b = ev.target.closest('button'); if (!b) return;
  if (b.id === 'qshuf') { prefs.qshuf = !prefs.qshuf; lsSet(LS_KEY, snapshot()); renderSelInfo(); return; }""")
rep("""  document.querySelectorAll('#modes button').forEach(b => b.classList.toggle('on', b.dataset.mode === prefs.mode));""",
"""  document.querySelectorAll('#modes button[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === prefs.mode));
  { const qs = $('#qshuf'); qs.classList.toggle('hidden', !SHUF_MODES.includes(prefs.mode)); qs.classList.toggle('on', !!prefs.qshuf); }""")
rep("""  if (prefs.mode === 'random') pool = prefs.lv === 9""",
"""  if (prefs.mode === 'random' || (prefs.qshuf && SHUF_MODES.includes(prefs.mode))) pool = prefs.lv === 9""")
rep("""function shuffle(a){""", """const SHUF_MODES = ['unsolved', 'review', 'due', 'wcount'];
function shuffle(a){""")

# 3) 교수님별 상자: 시작할 때마다 새로 섞기
rep("""onclick: () => startSession(jq, `${pf.n} 족보`)}""",
    """onclick: () => startSession(prefs.pmode === 'random' ? order(shuffle(jq.slice())) : jq, `${pf.n} 족보`)}""")
rep("""onclick: () => startSession(ownOut, `${pf.n} 직접 출제(범위 밖)`)}""",
    """onclick: () => startSession(prefs.pmode === 'random' ? shuffle(ownOut.slice()) : ownOut, `${pf.n} 직접 출제(범위 밖)`)}""")
rep("""onclick: () => startSession(pq, `${pf.n} 예상문제`)}""",
    """onclick: () => startSession(prefs.pmode === 'random' ? shuffle(pq.slice()) : pq, `${pf.n} 예상문제`)}""")

# 4) 보기 섞기: 보기 수만큼(2~10개)
rep("""  const marks = [...rest.matchAll(/[①②③④⑤]/g)];
  if (marks.length !== 5 || marks.map(m => m[0]).join('') !== '①②③④⑤') return q;
  const opts = []; let tail = '', multi = false;
  for (let k = 0; k < 5; k++) {
    const seg = rest.slice(marks[k].index + 1, k < 4 ? marks[k + 1].index : undefined);
    const nl = seg.indexOf('\\n');
    if (k < 4) {""",
"""  const N = q.n || 5, want = CIRC.slice(0, N).join('');
  const marks = [...rest.matchAll(/[①-⑩]/g)];
  if (N < 2 || N > 10 || marks.length !== N || marks.map(m => m[0]).join('') !== want) return q;
  const opts = []; let tail = '', multi = false;
  for (let k = 0; k < N; k++) {
    const seg = rest.slice(marks[k].index + 1, k < N - 1 ? marks[k + 1].index : undefined);
    const nl = seg.indexOf('\\n');
    if (k < N - 1) {""")
rep("""  if (!perm) { perm = shuffle([0, 1, 2, 3, 4]); S.mix[base.id] = perm; }""",
    """  if (!perm || perm.length !== N) { perm = shuffle([...Array(N).keys()]); S.mix[base.id] = perm; }""")
open(out, 'w', encoding='utf-8').write(h)
print('ok')
