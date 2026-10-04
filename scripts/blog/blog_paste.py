#!/usr/bin/env python3
"""메딕수학 블로그 '붙여넣기용' 페이지 생성기 (2026-10-01, 그림 복사 버튼 2026-10-04).

사용법:  python3 blog_paste.py post.md 출력폴더
→ 출력폴더/올리기.html  (같은 폴더에 있는 PNG를 그림 자리마다 미리보기로 보여 줌)

네이버 블로그 글쓰기에 원장님이 직접 올릴 때 쓰는 페이지:
제목 복사 → 본문 1 복사 → 그림 끌어다 놓기 → 본문 2 복사 → … → 해시태그 복사.
본문은 서식(■ 소제목 굵게) 있는 HTML과 일반 글 두 가지로 클립보드에 넣는다.
"""
import base64
import html
import json
import os
import re
import sys


def parse(md_text):
    # 머리말(--- ... ---) 떼기
    meta = {}
    m = re.match(r"^---\n(.*?)\n---\n", md_text, re.S)
    if m:
        for line in m.group(1).splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip()
        md_text = md_text[m.end():]
    lines = md_text.strip("\n").splitlines()
    title = meta.get("title", "")
    if lines and lines[0].startswith("# "):
        title = lines[0][2:].strip()
        lines = lines[1:]
    # 해시태그 줄(맨 끝 #로 시작하는 줄들)
    tags = []
    while lines and (not lines[-1].strip() or lines[-1].lstrip().startswith("#")):
        if lines[-1].strip():
            tags.insert(0, lines[-1].strip())
        lines.pop()
    # 그림 자리로 나누기
    blocks, cur = [], []
    for ln in lines:
        mm = re.match(r"^\s*\[이미지:\s*([^\]]+)\]\s*$", ln)
        if mm:
            blocks.append(("text", "\n".join(cur).strip("\n")))
            blocks.append(("image", mm.group(1).strip()))
            cur = []
        else:
            cur.append(ln)
    blocks.append(("text", "\n".join(cur).strip("\n")))
    blocks = [b for b in blocks if not (b[0] == "text" and not b[1].strip())]
    return meta, title, blocks, " ".join(tags)


BOLD = re.compile(r"\*\*(.+?)\*\*")


def plain(text):
    return BOLD.sub(r"\1", text)


def to_rich(text):
    out = []
    for ln in text.splitlines():
        s = BOLD.sub(r"<b>\1</b>", html.escape(ln))
        if not ln.strip():
            out.append("<p><br></p>")
        elif ln.startswith("■ "):
            out.append(f"<p><b>{s}</b></p>")
        elif ln.startswith("부제:"):
            out.append(f"<p><i>{s}</i></p>")
        else:
            out.append(f"<p>{s}</p>")
    return "".join(out)


PAGE = """<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>올리기 · __TITLE__</title>
<style>
:root{--bg:#F7F5F1;--ink:#1C1A16;--muted:#6B655C;--red:#A83232;--line:#E4DFD6;--card:#fff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;word-break:keep-all}
.wrap{max-width:860px;margin:0 auto;padding:28px 16px 80px}
h1{font-size:22px;margin:0 0 6px}.lead{color:var(--muted);font-size:14px;margin:0 0 20px;line-height:1.6}
.step{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:12px 0;position:relative}
.step.done{opacity:.55}.step.done .no{background:#3d7a4a}
.head{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.no{background:var(--red);color:#fff;font-weight:700;font-size:13px;border-radius:999px;min-width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;padding:0 8px}
.what{font-weight:700;font-size:15px;flex:1}
button{background:var(--ink);color:#fff;border:0;border-radius:8px;padding:9px 16px;font-size:14px;font-weight:700;cursor:pointer}
button.ok{background:#3d7a4a}
pre{white-space:pre-wrap;margin:0;font-family:inherit;font-size:14px;line-height:1.65;max-height:220px;overflow:auto;background:var(--bg);border-radius:6px;padding:10px 12px}
.img{display:flex;gap:14px;align-items:center}.img img{width:170px;height:170px;border:1px solid var(--line);border-radius:6px;cursor:grab;flex:none}
.head button+button{margin-left:6px}button.sub{background:#fff;color:var(--ink);border:1px solid var(--line)}
.img .fn{font-family:ui-monospace,Menlo,monospace;font-size:13px;background:var(--bg);padding:2px 6px;border-radius:4px}
.tip{font-size:13px;color:var(--muted);line-height:1.55;margin-top:6px}
</style></head><body><div class="wrap">
<h1>네이버 블로그 올리기</h1>
<p class="lead">위에서부터 차례로 <b>복사</b> 누르고 → 네이버 글쓰기에 붙여넣기(⌘V). 글도 그림도 똑같이 <b>복사 → 붙여넣기</b>입니다.
다 한 칸은 흐리게 바뀝니다. 마지막에 <b>첫 번째 그림(00번)을 대표 이미지</b>로 지정하고 발행하시면 됩니다.<br>
그림 복사가 안 되면: 그림 위에서 오른쪽 클릭 → "이미지 복사", 또는 끌어다 놓기.</p>
__STEPS__
</div>
<script>
const DATA = __DATA__;
async function copy(i, btn){
  const d = DATA[i];
  try{
    if (window.ClipboardItem && d.html){
      await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([d.html],{type:'text/html'}),'text/plain':new Blob([d.text],{type:'text/plain'})})]);
    } else { await navigator.clipboard.writeText(d.text); }
  }catch(e){
    const ta=document.createElement('textarea'); ta.value=d.text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  btn.textContent='복사됨 ✓'; btn.classList.add('ok'); btn.closest('.step').classList.add('done');
}
function done(el){ el.closest('.step').classList.add('done'); }
async function copyImg(btn){
  const step = btn.closest('.step'), img = step.querySelector('img');
  const ok = (msg) => { btn.textContent = msg || '복사됨 ✓'; btn.classList.add('ok'); step.classList.add('done'); };
  const toPng = () => new Promise((res, rej) => {
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0); c.toBlob(b => b ? res(b) : rej(new Error('blob')), 'image/png');
  });
  let why = '';
  // 1) 그림 자체(PNG)를 클립보드에 — Chrome·Safari·Edge 최신판
  try {
    if (!navigator.clipboard || !window.ClipboardItem) throw new Error('이 브라우저는 그림 복사를 지원하지 않음');
    await navigator.clipboard.write([new ClipboardItem({'image/png': toPng()})]);
    return ok();
  } catch (e) { why = e.name || e.message; }
  // 2) 권한이 막힌 곳(앱 미리보기 창 등): 그림을 선택해서 복사 — 붙여넣으면 그림이 들어감
  try {
    const box = document.createElement('div');
    box.contentEditable = 'true'; box.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    const im = document.createElement('img'); im.src = img.src; box.appendChild(im); document.body.appendChild(box);
    const r = document.createRange(); r.selectNode(im); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    const done = document.execCommand('copy'); sel.removeAllRanges(); box.remove();
    if (done) return ok('복사됨 ✓');
  } catch (e) {}
  btn.textContent = '복사 안 됨';
  const tip = step.querySelector('.tip');
  if (tip && !step.querySelector('.why')) tip.insertAdjacentHTML('afterend',
    '<div class="tip why" style="color:#a83232">이 화면에서는 그림 복사가 막혀 있어요(' + why + '). 맥 Finder에서 이 html을 크롬이나 사파리로 열거나, 그림 위에서 오른쪽 클릭 → "이미지 복사"를 쓰세요.</div>');
}
</script></body></html>"""


def build(md_path, out_dir):
    meta, title, blocks, tags = parse(open(md_path, encoding="utf-8").read())
    data, steps = [], []
    n = 0

    def add_copy(label, text, rich=None):
        nonlocal n
        n += 1
        i = len(data)
        data.append({"text": text, "html": rich})
        steps.append(
            f'<div class="step"><div class="head"><span class="no">{n}</span><span class="what">{html.escape(label)}</span>'
            f'<button onclick="copy({i},this)">복사</button></div><pre>{html.escape(text)}</pre></div>'
        )

    add_copy("제목 — 네이버 글쓰기의 제목 칸에 붙여넣기", plain(title))
    part = 0
    for kind, val in blocks:
        if kind == "text":
            part += 1
            add_copy(f"본문 {part} — 본문에 붙여넣기", plain(val), to_rich(val))
        else:
            n += 1
            fp = os.path.join(out_dir, val)
            if os.path.exists(fp):
                # 그림을 html 안에 넣어 둔다 — 파일 하나만 열어도 보이고, '복사' 버튼으로 바로 클립보드에 넣을 수 있게
                src = "data:image/png;base64," + base64.b64encode(open(fp, "rb").read()).decode()
                warn = ""
            else:
                src = html.escape(val)
                warn = '<div class="tip">⚠️ 이 폴더에 파일이 없습니다.</div>'
            label = "그림 — 대표 이미지(00번)" if val.startswith("00") else "그림 — 본문에 붙여넣기"
            steps.append(
                f'<div class="step"><div class="head"><span class="no">{n}</span><span class="what">{label}</span>'
                f'<button onclick="copyImg(this)">복사</button><button class="sub" onclick="done(this)">넣었어요</button></div>'
                f'<div class="img"><img src="{src}" alt="{html.escape(val)}" draggable="true">'
                f'<div><span class="fn">{html.escape(val)}</span><div class="tip">[복사] 누르고 네이버 글쓰기에 ⌘V.<br>'
                f'안 되면 그림을 끌어다 놓거나, [사진] 버튼으로 같은 폴더의 이 파일을 올리세요.</div>{warn}</div></div></div>'
            )
    if tags:
        add_copy("해시태그 — 본문 맨 끝(또는 태그 칸)에 붙여넣기", tags)
    page = (
        PAGE.replace("__TITLE__", html.escape(title))
        .replace("__STEPS__", "\n".join(steps))
        .replace("__DATA__", json.dumps(data, ensure_ascii=False).replace("</", "<\\/"))
    )
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, "올리기.html")
    open(path, "w", encoding="utf-8").write(page)
    print(path)
    return path


if __name__ == "__main__":
    build(sys.argv[1], sys.argv[2])
