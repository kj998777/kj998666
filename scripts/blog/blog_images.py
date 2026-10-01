#!/usr/bin/env python3
"""메딕수학 블로그 이미지 생성기 (2026-10-01).

사용법:  python3 blog_images.py spec.json
spec.json 예:
{
  "out_dir": "out/2026-10-05",
  "footer": "메딕수학 정리 시험지 35개 · 문항 827개 기준 (2026.10)",
  "images": [
    {"kind": "thumbnail", "file": "00_thumb.png", "kicker": "내신 수학 데이터", "title": "시험지 35개를 뜯어보니\\n점수의 절반은\\n기본 문제에", "stat": "56.6점", "stat_label": "하·중하·중 문항 평균 배점"},
    {"kind": "bars", "file": "01_diff.png", "title": "난이도별 배점 비중", "subtitle": "시험 한 장 100점 기준",
     "unit": "%", "rows": [{"label": "하", "value": 20.5}, ...], "highlight": ["하", "중하", "중"], "note": "빨간 막대 = 기본 문항"},
    {"kind": "compare", "file": "02_mid_high.png", "title": "...", "series": ["중학교", "고등학교"], "unit": "%",
     "rows": [{"label": "상", "values": [1.3, 15.1]}, ...]},
    {"kind": "stat", "file": "03_stat.png", "title": "...", "stat": "1.6개", "stat_label": "...", "body": "..."},
    {"kind": "card", "file": "04_steps.png", "title": "...", "items": ["...", "..."]}
  ]
}
모든 이미지 1080×1080 PNG. 색: 바탕 #F7F5F1, 글자 #1C1A16, 강조 빨강 #A83232, 비교용 파랑 #3A6EA5,
배경 막대 회색 #CFC9BE(강조가 아닌 막대 — 일부러 회색). 빨강·파랑 짝은 dataviz 검증기 통과(색약 ΔE 17.9).
"""
import html
import json
import os
import sys

from playwright.sync_api import sync_playwright

BG, INK, MUTED, RED, BLUE, GRAY, LINE = "#F7F5F1", "#1C1A16", "#6B655C", "#A83232", "#3A6EA5", "#CFC9BE", "#E4DFD6"
W = H = 1080

BASE_CSS = f"""
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
html, body {{ width: {W}px; height: {H}px; background: {BG}; color: {INK};
  font-family: 'Noto Sans CJK KR', 'Noto Sans KR', sans-serif; word-break: keep-all; }}
.page {{ position: relative; width: {W}px; height: {H}px; padding: 88px 88px 0; display: flex; flex-direction: column; }}
.brand {{ display: flex; align-items: center; gap: 14px; font-weight: 900; font-size: 30px; letter-spacing: 0.02em; }}
.brand .mark {{ width: 18px; height: 18px; background: {RED}; }}
.brand .en {{ color: {MUTED}; font-weight: 700; font-size: 22px; letter-spacing: 0.18em; }}
.title {{ font-weight: 900; font-size: 60px; line-height: 1.22; margin-top: 52px; letter-spacing: -0.02em; }}
.subtitle {{ font-weight: 500; font-size: 30px; color: {MUTED}; margin-top: 18px; }}
.footer {{ position: absolute; left: 0; right: 0; bottom: 0; height: 96px; background: {INK}; color: {BG};
  display: flex; align-items: center; justify-content: space-between; padding: 0 88px; font-size: 24px; font-weight: 500; }}
.footer .src {{ color: #BDB6AA; font-size: 21px; }}
.note {{ position: absolute; left: 88px; right: 88px; bottom: 124px; font-size: 22px; color: {MUTED}; line-height: 1.45; }}
"""


def esc(s):
    return html.escape(str(s)).replace("\\n", "<br>").replace("\n", "<br>")


def fmt(v, unit):
    if v is None:
        return "–"
    s = f"{v:.1f}".rstrip("0").rstrip(".") if isinstance(v, float) else str(v)
    return f"{s}{unit}"


def footer(spec, img):
    src = img.get("footer", spec.get("footer", ""))
    return f'<div class="footer"><span>제주시 중앙로 312 · 메딕수학</span><span class="src">{esc(src)}</span></div>'


def brand():
    return '<div class="brand"><span class="mark"></span>메딕수학<span class="en">MEDIC MATH</span></div>'


def page_thumbnail(spec, img):
    return f"""
<style>
.kicker {{ display: inline-block; margin-top: 70px; background: {RED}; color: #fff; font-weight: 700; font-size: 28px; padding: 10px 22px; }}
.t {{ font-weight: 900; font-size: 84px; line-height: 1.16; margin-top: 34px; letter-spacing: -0.03em; }}
.statbox {{ position: absolute; left: 88px; right: 88px; bottom: 150px; display: flex; align-items: flex-end; gap: 28px;
  border-top: 4px solid {INK}; padding-top: 28px; }}
.stat {{ font-weight: 900; font-size: 132px; color: {RED}; line-height: 0.9; letter-spacing: -0.03em; }}
.sl {{ font-size: 30px; font-weight: 700; color: {INK}; line-height: 1.35; padding-bottom: 8px; }}
</style>
<div class="page">{brand()}
<div><span class="kicker">{esc(img.get('kicker', '내신 수학 데이터'))}</span></div>
<div class="t">{esc(img['title'])}</div>
{f'<div class="statbox"><div class="stat">{esc(img["stat"])}</div><div class="sl">{esc(img.get("stat_label", ""))}</div></div>' if img.get('stat') else ''}
{footer(spec, img)}</div>"""


def page_bars(spec, img):
    rows = img["rows"]
    unit = img.get("unit", "")
    hi = set(img.get("highlight", []))
    vmax = img.get("max") or max(r["value"] for r in rows) or 1
    n = len(rows)
    bar_h = 104 if n <= 3 else 78 if n <= 6 else 52 if n <= 9 else 36
    gap = 40 if n <= 3 else 30 if n <= 6 else 18 if n <= 9 else 12
    longest = max(max(len(r["label"]) for r in rows), max((len(r.get("sub", "")) * 0.62 for r in rows), default=0))
    label_w = img.get("label_width", 130 if longest <= 3 else 230 if longest <= 7 else 300)
    items = []
    for r in rows:
        w = max(0.4, r["value"] / vmax * 100)
        color = RED if (r["label"] in hi or not hi) else GRAY
        sub = f'<span class="rsub">{esc(r["sub"])}</span>' if r.get("sub") else ""
        items.append(
            f'<div class="row"><div class="lab">{esc(r["label"])}{sub}</div>'
            f'<div class="track"><div class="bar" style="width:{w:.2f}%;background:{color}"></div>'
            f'<div class="val" style="left:calc({w:.2f}% + 14px)">{esc(fmt(r["value"], unit))}</div></div></div>'
        )
    return f"""
<style>
.rows {{ flex: 1; display: flex; flex-direction: column; justify-content: center; gap: {gap}px; padding-bottom: {200 if img.get('note') else 150}px; }}
.row {{ display: flex; align-items: center; height: {bar_h}px; }}
.lab {{ width: {label_w}px; flex: none; font-size: {(38 if bar_h >= 78 else 32 if bar_h >= 46 else 26) - (6 if max(len(r["label"]) for r in rows) > 7 else 0)}px; font-weight: 700; line-height: 1.15; padding-right: 16px; }}
.rsub {{ display: block; font-size: {22 if bar_h >= 78 else 20}px; margin-top: 4px; font-weight: 500; color: {MUTED}; }}
.track {{ position: relative; flex: 1; height: 100%; margin-right: 110px; border-left: 2px solid {INK}; }}
.bar {{ height: 100%; border-radius: 0 4px 4px 0; }}
.val {{ position: absolute; top: 50%; transform: translateY(-50%); font-size: {40 if bar_h >= 78 else 32 if bar_h >= 46 else 26}px; font-weight: 900; white-space: nowrap; }}
</style>
<div class="page">{brand()}
<div class="title">{esc(img['title'])}</div>
{f'<div class="subtitle">{esc(img["subtitle"])}</div>' if img.get('subtitle') else ''}
<div class="rows">{''.join(items)}</div>
{f'<div class="note">{esc(img["note"])}</div>' if img.get('note') else ''}
{footer(spec, img)}</div>"""


def page_compare(spec, img):
    rows = img["rows"]
    unit = img.get("unit", "")
    series = img["series"]
    colors = img.get("colors", [BLUE, RED])
    vmax = img.get("max") or max(max(v for v in r["values"] if v is not None) for r in rows) or 1
    legend = "".join(
        f'<span class="lg"><span class="sw" style="background:{colors[i]}"></span>{esc(s)}</span>' for i, s in enumerate(series)
    )
    groups = []
    for r in rows:
        bars = []
        for i, v in enumerate(r["values"]):
            w = max(0.4, (v or 0) / vmax * 100)
            bars.append(
                f'<div class="track"><div class="bar" style="width:{w:.2f}%;background:{colors[i]}"></div>'
                f'<div class="val" style="left:calc({w:.2f}% + 12px)">{esc(fmt(v, unit))}</div></div>'
            )
        groups.append(f'<div class="grp"><div class="lab">{esc(r["label"])}</div><div class="bars">{"".join(bars)}</div></div>')
    return f"""
<style>
.legend {{ display: flex; gap: 34px; margin-top: 34px; font-size: 28px; font-weight: 700; }}
.lg {{ display: flex; align-items: center; gap: 12px; }}
.sw {{ width: 26px; height: 26px; border-radius: 4px; }}
.groups {{ flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 34px; padding-bottom: {200 if img.get('note') else 150}px; }}
.grp {{ display: flex; align-items: center; }}
.lab {{ width: 230px; flex: none; font-size: 30px; font-weight: 700; line-height: 1.2; }}
.bars {{ flex: 1; display: flex; flex-direction: column; gap: 2px; border-left: 2px solid {INK}; margin-right: 110px; }}
.track {{ position: relative; height: {54 if len(rows) <= 4 else 40}px; }}
.bar {{ height: 100%; border-radius: 0 4px 4px 0; }}
.val {{ position: absolute; top: 50%; transform: translateY(-50%); font-size: 26px; font-weight: 900; white-space: nowrap; }}
</style>
<div class="page">{brand()}
<div class="title">{esc(img['title'])}</div>
{f'<div class="subtitle">{esc(img["subtitle"])}</div>' if img.get('subtitle') else ''}
<div class="legend">{legend}</div>
<div class="groups">{''.join(groups)}</div>
{f'<div class="note">{esc(img["note"])}</div>' if img.get('note') else ''}
{footer(spec, img)}</div>"""


def page_stat(spec, img):
    return f"""
<style>
.big {{ font-weight: 900; font-size: 200px; color: {RED}; line-height: 1; margin-top: 70px; letter-spacing: -0.04em; }}
.sl {{ font-size: 40px; font-weight: 900; margin-top: 26px; line-height: 1.3; }}
.body {{ font-size: 32px; font-weight: 500; color: {INK}; margin-top: 44px; line-height: 1.6; border-left: 6px solid {RED}; padding-left: 28px; }}
</style>
<div class="page">{brand()}
<div class="title" style="font-size:52px">{esc(img['title'])}</div>
<div class="big">{esc(img['stat'])}</div>
<div class="sl">{esc(img.get('stat_label', ''))}</div>
{f'<div class="body">{esc(img["body"])}</div>' if img.get('body') else ''}
{f'<div class="note">{esc(img["note"])}</div>' if img.get('note') else ''}
{footer(spec, img)}</div>"""


def page_card(spec, img):
    items = "".join(
        f'<li><span class="no">{i + 1:02d}</span><span class="tx">{esc(t)}</span></li>' for i, t in enumerate(img["items"])
    )
    size = 36 if len(img["items"]) <= 4 else 31
    return f"""
<style>
ol {{ list-style: none; margin-top: 54px; display: flex; flex-direction: column; gap: 30px; }}
li {{ display: flex; gap: 28px; align-items: baseline; border-bottom: 2px solid {LINE}; padding-bottom: 26px; }}
.no {{ font-weight: 900; font-size: 40px; color: {RED}; flex: none; width: 70px; }}
.tx {{ font-size: {size}px; font-weight: 700; line-height: 1.4; }}
</style>
<div class="page">{brand()}
<div class="title">{esc(img['title'])}</div>
{f'<div class="subtitle">{esc(img["subtitle"])}</div>' if img.get('subtitle') else ''}
<ol>{items}</ol>
{f'<div class="note">{esc(img["note"])}</div>' if img.get('note') else ''}
{footer(spec, img)}</div>"""


KINDS = {"thumbnail": page_thumbnail, "bars": page_bars, "compare": page_compare, "stat": page_stat, "card": page_card}


def render(spec_path):
    spec = json.load(open(spec_path, encoding="utf-8"))
    out_dir = spec.get("out_dir", "out")
    os.makedirs(out_dir, exist_ok=True)
    made = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
        for i, img in enumerate(spec["images"]):
            body = KINDS[img["kind"]](spec, img)
            pg.set_content(f"<!doctype html><html lang='ko'><head><meta charset='utf-8'><style>{BASE_CSS}</style></head><body>{body}</body></html>")
            pg.wait_for_timeout(150)
            # 넘침 검사: 내용이 아래 띠(footer)를 덮으면 경고
            over = pg.evaluate(
                """() => { const f = document.querySelector('.footer').getBoundingClientRect().top;
                 const els = [...document.querySelectorAll('.page > *:not(.footer):not(.note):not(.rows):not(.groups), .rows > *, .groups > *')];
                 const b = Math.max(...els.map(e => e.getBoundingClientRect().bottom));
                 const n = document.querySelector('.note'); const nt = n ? n.getBoundingClientRect().top : f;
                 return { bottom: b, limit: Math.min(f, nt) }; }"""
            )
            path = os.path.join(out_dir, img.get("file") or f"{i:02d}_{img['kind']}.png")
            pg.screenshot(path=path, full_page=False)
            flag = " ⚠️ 넘침" if over["bottom"] > over["limit"] - 8 else ""
            made.append(path)
            print(f"{path}{flag}")
        b.close()
    return made


if __name__ == "__main__":
    render(sys.argv[1])
