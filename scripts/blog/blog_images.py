#!/usr/bin/env python3
"""메딕수학 블로그 이미지 생성기 (2026-10-01, 시리즈별 대표 이미지 2026-10-04).

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
대표 이미지(00)는 시리즈별로 종류가 다르다 — thumbnail / thumb_cells / thumb_exam / thumb_bold (아래 page_thumb_* 설명 참고).
  thumb_cells 예: {"kind":"thumb_cells","kicker":"중앙여고 기출 분석","title":"작년 ...\n... *100점*을 펼치면",
                   "items":[[1,3,0],[2,3,0],...],  (또는 "red": 44)  "legend":["중상·상 8문항","하~중 14문항","한 칸 = 1점"],
                   "stat":"51칸","stat_label":"100점 중 절반 이상이\n어려운 8문항에","foot":"2025년 2학기 중간고사 · 22문항"}
  thumb_exam 예:  {"kind":"thumb_exam","header":["2학기 중간고사 대비","수학","고2","메딕수학"],"paper_title":"...",
                   "rows":[{"n":"1.","right":"[3점]"},...,{"n":"16.","right":"[7점]","red":true,"circle":true}],
                   "pen_note":"16~18번\n모두 '상'!","pen_big":"51점","pen_small":"← ...","tag":"메딕수학 · 시험 대비"}
  thumb_bold 예:  {"kind":"thumb_bold","kicker":"메딕수학 이야기","sub":"...","title":"승부는\n이 세 문제",
                   "balls":[{"big":"16","cap":"상 · 7점"}],"bottom":"세 문제 모두 **함수의 연속**"}
모든 이미지 1080×1080 PNG. 색: 바탕 #F7F5F1, 글자 #1C1A16, 강조 빨강 #A83232, 비교용 파랑 #3A6EA5,
배경 막대 회색 #CFC9BE(강조가 아닌 막대 — 일부러 회색). 빨강·파랑 짝은 dataviz 검증기 통과(색약 ΔE 17.9).
"""
import html
import json
import os
import re
import sys
import tempfile

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


# ───────────────────────── 시리즈별 대표 이미지 (2026-10-04) ─────────────────────────
# 시리즈마다 대표 이미지 모양을 다르게 쓴다(playbook 4번 "시리즈별 대표 이미지" 표).
#   thumbnail   : 데이터로 보는 내신(통계 글) — 미색 바탕, 큰 제목, 빨간 숫자
#   thumb_cells : 학교별 기출 분석 — 검은 바탕, 100칸(한 칸 = 1점/1%) 중 빨간 칸
#   thumb_exam  : 공부법·시험 대비 — 시험지 위에 빨간 펜(손글씨 글꼴 Nanum Pen Script, OFL)
#   thumb_bold  : 메딕수학 이야기(학원·메딕차트) — 빨간 바탕, 큰 글씨, 흰 동그라미
# 제목 등에서 *글자* 는 강조색, **글자** 는 검은 띠 강조(thumb_bold 아래 문장)로 바뀐다.

def em(s):
    t = esc(s)
    t = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", t)
    return re.sub(r"\*(.+?)\*", r"<em>\1</em>", t)


THUMB_CSS = """
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 1080px; height: 1080px; overflow: hidden; word-break: keep-all;
  font-family: 'Noto Sans CJK KR', 'Noto Sans KR', sans-serif; }
.pen { font-family: 'Nanum Pen Script', 'Noto Sans CJK KR', cursive; }
.serif { font-family: 'Noto Serif CJK KR', 'Noto Serif KR', serif; }
"""


def page_thumb_cells(spec, img):
    cells = ""
    if img.get("items"):  # [[번호, 배점, 어려움(1/0)], ...] — 배점 합이 100이면 한 칸 = 1점
        for n, pts, hard in img["items"]:
            for k in range(int(pts)):
                lab = f' data-n="{esc(n)}"' if k == 0 else ""
                cells += f'<i class="{"r" if hard else "g"}"{lab}></i>'
    else:  # "red": 100칸 중 빨간 칸 수(예: 44.3% → 44)
        red = int(round(float(img.get("red", 0))))
        cells = '<i class="r"></i>' * red + '<i class="g"></i>' * (100 - red)
    leg = img.get("legend", ["어려운 문항", "나머지", "한 칸 = 1점"])
    leg_html = (f'<span><s style="background:#d9433e"></s>{esc(leg[0])}</span>'
                f'<span><s style="background:#3a362f"></s>{esc(leg[1])}</span>'
                + (f'<span class="m">{esc(leg[2])}</span>' if len(leg) > 2 and leg[2] else ""))
    return f"""
<style>
body {{ background: #15130f; color: #f3efe6; }}
.top {{ position: absolute; left: 84px; top: 78px; right: 84px; display: flex; justify-content: space-between; align-items: center; }}
.k {{ font-weight: 700; font-size: 26px; letter-spacing: .06em; color: #bdb6aa; }} .k b {{ color: #e0524d; }}
.brand2 {{ font-weight: 900; font-size: 26px; }}
h1 {{ position: absolute; left: 84px; right: 84px; top: 140px; font-weight: 900; font-size: 66px; line-height: 1.2; letter-spacing: -.02em; }}
h1 em {{ font-style: normal; color: #e0524d; }}
.grid {{ position: absolute; left: 84px; top: 350px; display: grid; grid-template-columns: repeat(20, 1fr); gap: 7px; width: 912px; }}
.grid i {{ display: block; aspect-ratio: 1; border-radius: 5px; position: relative; }}
.grid i.g {{ background: #3a362f; }} .grid i.r {{ background: #d9433e; }}
.grid i[data-n]::after {{ content: attr(data-n); position: absolute; left: 4px; top: 1px; font-size: 14px; font-weight: 700; font-style: normal; color: rgba(255,255,255,.65); }}
.leg {{ position: absolute; left: 84px; top: 640px; display: flex; gap: 34px; font-size: 26px; font-weight: 700; color: #d9d3c6; }}
.leg span {{ display: flex; align-items: center; gap: 10px; }} .leg s {{ display: inline-block; width: 24px; height: 24px; border-radius: 5px; }}
.leg .m {{ color: #8f887c; font-weight: 500; }}
.big {{ position: absolute; left: 84px; right: 84px; bottom: 130px; display: flex; align-items: flex-end; gap: 30px; }}
.big .v {{ font-weight: 900; font-size: 190px; line-height: .8; color: #e0524d; letter-spacing: -.04em; white-space: nowrap; }}
.big .t {{ font-size: 34px; font-weight: 700; line-height: 1.4; padding-bottom: 6px; }}
.foot {{ position: absolute; left: 84px; right: 84px; bottom: 46px; font-size: 21px; color: #8f887c; display: flex; justify-content: space-between; }}
</style>
<div class="top"><div class="k"><b>■</b> {esc(img.get('kicker', '학교별 기출 분석'))}</div><div class="brand2">메딕수학</div></div>
<h1>{em(img['title'])}</h1>
<div class="grid">{cells}</div>
<div class="leg">{leg_html}</div>
<div class="big"><div class="v">{esc(img.get('stat', ''))}</div><div class="t">{esc(img.get('stat_label', ''))}</div></div>
<div class="foot"><span>{esc(img.get('foot', spec.get('footer', '')))}</span><span>제주시 중앙로 312 · 메딕수학</span></div>"""


def page_thumb_exam(spec, img):
    # rows: [{"n": "16.", "right": "[7점]", "red": true, "circle": true}, ...] 최대 18줄(2단 × 9).
    # 동그라미(circle) 줄은 오른쪽 단 맨 아래(마지막 줄들)에 두고, 그 줄의 right는 5글자 이하(예: "[7점]")로 — 손글씨 메모(pen_note) 자리와 겹치지 않게.
    rows = ""
    for r in img["rows"][:18]:
        cls = "q" + (" h" if r.get("red") else "") + (" s" if r.get("circle") else "")
        circ = '<span class="circ"></span>' if r.get("circle") else ""
        rows += (f'<div class="{cls}"><span class="n">{esc(r.get("n", ""))}</span><span class="line"></span>'
                 f'<span class="pt">{esc(r.get("right", ""))}</span>{circ}</div>')
    head = img.get("header", ["시험", "수학", "", "메딕수학"])
    head_html = "".join(f"<div>{esc(h)}</div>" for h in head if h is not None)
    return f"""
<style>
body {{ background: #d9d4c8; }}
.paper {{ position: absolute; left: 70px; top: 58px; width: 940px; height: 1000px; background: #fffdf8; box-shadow: 0 18px 40px rgba(0,0,0,.18); transform: rotate(-1.6deg); padding: 56px 64px; }}
.hd {{ border: 2.5px solid #222; display: flex; font-size: 24px; color: #222; }}
.hd div {{ padding: 12px 18px; border-right: 2px solid #222; white-space: nowrap; }} .hd div:last-child {{ border-right: 0; flex: 1; text-align: right; color: #777; }}
.ttl {{ font-weight: 700; font-size: 40px; text-align: center; margin: 34px 0 26px; color: #222; letter-spacing: .04em; }}
.cols {{ columns: 2; column-gap: 56px; border-top: 2px solid #222; padding-top: 22px; }}
.q {{ display: flex; align-items: center; gap: 10px; height: 62px; font-size: 24px; color: #444; position: relative; break-inside: avoid; }}
.q .n {{ min-width: 44px; font-weight: 700; color: #222; white-space: nowrap; }}
.q .line {{ flex: 1; height: 10px; background: repeating-linear-gradient(90deg, #d6d0c4 0 70%, transparent 70% 100%); background-size: 46px 10px; border-radius: 3px; }}
.q.s .line {{ flex: 0 0 70px; }} .q.s .pt {{ margin-right: auto; max-width: 110px; overflow: hidden; text-overflow: ellipsis; }}
.q .pt {{ font-size: 20px; color: #888; white-space: nowrap; }} .q.h .pt {{ color: #b0302f; font-weight: 700; }}
.circ {{ position: absolute; left: -14px; top: 6px; width: 66px; height: 52px; border: 4px solid #c62f2f; border-radius: 50%; transform: rotate(-8deg); }}
.note {{ position: absolute; color: #c62f2f; line-height: 1; }}
.n1 {{ right: 62px; top: 668px; font-size: 52px; transform: rotate(-4deg); text-align: right; }}
.n2 {{ left: 84px; bottom: 92px; font-size: 108px; transform: rotate(-3deg); }}
.n3 {{ left: 96px; bottom: 46px; font-size: 46px; color: #7a2320; transform: rotate(-2deg); }}
.tag {{ position: absolute; right: 52px; bottom: 40px; background: #1c1a16; color: #f7f5f1; font-weight: 700; font-size: 28px; padding: 14px 22px; transform: rotate(1.6deg); }}
.tag b {{ color: #ff8a80; }}
</style>
<div class="paper">
 <div class="hd serif">{head_html}</div>
 <div class="ttl serif">{esc(img.get('paper_title', ''))}</div>
 <div class="cols serif">{rows}</div>
 <div class="note pen n1">{esc(img.get('pen_note', ''))}</div>
 <div class="note pen n2">{esc(img.get('pen_big', ''))}</div>
 <div class="note pen n3">{esc(img.get('pen_small', ''))}</div>
</div>
<div class="tag"><b>■</b> {esc(img.get('tag', '메딕수학'))}</div>"""


def page_thumb_bold(spec, img):
    balls = "".join(
        f'<div class="ball"><div class="num">{esc(b.get("big", ""))}</div><div class="cap">{esc(b.get("cap", ""))}</div></div>'
        for b in img.get("balls", [])[:3]
    )
    return f"""
<style>
body {{ background: #a83232; color: #fff; }}
.wrap {{ position: absolute; inset: 0; padding: 86px 84px; }}
.k {{ display: inline-block; background: #fff; color: #a83232; font-weight: 900; font-size: 28px; padding: 10px 20px; }}
.sub {{ font-size: 38px; font-weight: 700; margin-top: 44px; line-height: 1.35; opacity: .92; }}
h1 {{ font-size: 118px; font-weight: 900; line-height: 1.02; letter-spacing: -.04em; margin-top: 18px; }}
h1 em {{ font-style: normal; color: #1c1a16; }}
.balls {{ display: flex; gap: 34px; margin-top: 64px; }}
.ball {{ width: 268px; height: 268px; border-radius: 50%; background: #fff; color: #a83232; display: flex; flex-direction: column; align-items: center; justify-content: center; box-shadow: 0 14px 0 rgba(0,0,0,.18); text-align: center; }}
.num {{ font-size: 120px; font-weight: 900; line-height: .95; letter-spacing: -.04em; white-space: nowrap; }}
.cap {{ font-size: 27px; font-weight: 700; color: #1c1a16; margin-top: 8px; padding: 0 20px; line-height: 1.25; }}
.bot {{ position: absolute; left: 84px; right: 84px; bottom: 70px; display: flex; justify-content: space-between; align-items: flex-end; gap: 30px; }}
.bot .t {{ font-size: 30px; font-weight: 700; line-height: 1.45; }} .bot .t b {{ background: #1c1a16; padding: 2px 10px; }}
.bot .m {{ font-weight: 900; font-size: 30px; text-align: right; white-space: nowrap; }} .bot .m span {{ display: block; font-size: 20px; font-weight: 500; opacity: .8; letter-spacing: .14em; }}
</style>
<div class="wrap">
 <span class="k">{esc(img.get('kicker', '메딕수학 이야기'))}</span>
 <div class="sub">{em(img.get('sub', ''))}</div>
 <h1>{em(img['title'])}</h1>
 <div class="balls">{balls}</div>
</div>
<div class="bot"><div class="t">{em(img.get('bottom', ''))}</div><div class="m">메딕수학<span>MEDIC MATH</span></div></div>"""


KINDS = {"thumbnail": page_thumbnail, "bars": page_bars, "compare": page_compare, "stat": page_stat, "card": page_card,
         "thumb_cells": page_thumb_cells, "thumb_exam": page_thumb_exam, "thumb_bold": page_thumb_bold}
THUMB_KINDS = {"thumb_cells", "thumb_exam", "thumb_bold"}


def pen_font_css():
    """손글씨 글꼴(Nanum Pen Script, OFL) CSS 경로. 없으면 npm으로 한 번 받아 둔다. 실패하면 None(기본 글꼴로 대신)."""
    base = os.environ.get("MEDIC_FONT_DIR", os.path.expanduser("~/.cache/medic-blog-fonts"))
    css = os.path.join(base, "package", "index.css")
    if os.path.exists(css):
        return css
    try:
        import glob
        import subprocess
        import tarfile
        os.makedirs(base, exist_ok=True)
        subprocess.run(["npm", "pack", "@fontsource/nanum-pen-script"], cwd=base, check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
        tgz = sorted(glob.glob(os.path.join(base, "fontsource-nanum-pen-script-*.tgz")))[-1]
        with tarfile.open(tgz) as t:
            t.extractall(base)
        return css if os.path.exists(css) else None
    except Exception as e:  # 네트워크 막힘 등
        print(f"(손글씨 글꼴을 받지 못해 기본 글꼴로 그림: {e})")
        return None


def render(spec_path):
    spec = json.load(open(spec_path, encoding="utf-8"))
    out_dir = spec.get("out_dir", "out")
    os.makedirs(out_dir, exist_ok=True)
    made = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
        font_css = pen_font_css() if any(im["kind"] == "thumb_exam" for im in spec["images"]) else None
        font_link = f'<link rel="stylesheet" href="file://{font_css}">' if font_css else ""
        tmpdir = tempfile.mkdtemp(prefix="medic-blog-")
        for i, img in enumerate(spec["images"]):
            body = KINDS[img["kind"]](spec, img)
            css = THUMB_CSS if img["kind"] in THUMB_KINDS else BASE_CSS
            page_path = os.path.join(tmpdir, f"p{i:02d}.html")
            open(page_path, "w", encoding="utf-8").write(
                f"<!doctype html><html lang='ko'><head><meta charset='utf-8'>{font_link}<style>{css}</style></head><body>{body}</body></html>")
            pg.goto("file://" + page_path)
            pg.wait_for_timeout(700 if img["kind"] in THUMB_KINDS else 150)
            # 넘침 검사: 내용이 아래 띠(footer)를 덮으면 경고 (대표 이미지 종류는 글자가 1080칸 밖으로 나가는지만 본다)
            over = pg.evaluate(
                """() => { const ft = document.querySelector('.footer');
                 if (!ft) { const b = Math.max(...[...document.querySelectorAll('h1,.big,.balls,.bot,.grid,.leg,.paper,.wrap > *')].map(e => e.getBoundingClientRect().bottom), 0);
                            const w = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
                            return { bottom: w > 1080 ? 9999 : b, limit: 1080 }; }
                 const f = ft.getBoundingClientRect().top;
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
