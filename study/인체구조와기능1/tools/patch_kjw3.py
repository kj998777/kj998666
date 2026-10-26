"""새로 올라온 김진우p 학생발표(골반 97~122번)를 채점기 페이지에 연결

- PIMG_URL(해설 캡처 이름 → 자료 저장소 주소)을 kjt_blobs.json 전체로 바꿈
- 옆 창 발표 원본 목록(KJW_DECK의 L)을 kjw_decks.json 전체로 바꿈 (기존 순서 뒤에 새 발표가 붙으므로 D01~ 번호는 그대로)
- 계획표: 10/27에 새 골반 발표 문제 풀기

usage: python3 -I patch_kjw3.py <page.html> <out.html>
"""
import json, re, sys
from pathlib import Path
src, out = sys.argv[1:3]
h = open(src, encoding='utf-8').read()
T = Path(__file__).parent
BL = json.loads((T / 'kjt_blobs.json').read_text())
DK = json.loads((T / 'kjw_decks.json').read_text())

m = re.search(r"const PIMG_URL = (\{.*?\});", h)
assert m
BL = {**json.loads(m.group(1)), **BL}   # 페이지에만 있는 항목도 남김
h = h[:m.start(1)] + json.dumps(BL) + h[m.end(1):]
m = re.search(r"const KJW_DECK = \{\}; \(\(\) => \{ const L = (\{.*?\});\n", h)
assert m
old = json.loads(m.group(1))
assert list(DK)[:len(old)] == list(old), 'deck order changed'
h = h[:m.start(1)] + json.dumps(DK, ensure_ascii=False) + h[m.end(1):]
old_plan = "  ['2026-10-27', '남성 생식기관 강의(김진우) 날', [['강의 직후 길라잡이 남성 생식기관 정독', null, null],"
if old_plan in h and '골반 발표 새 문제' not in h:
    h = h.replace(old_plan, "  ['2026-10-27', '남성 생식기관 강의(김진우) 날', [['강의 직후 길라잡이 남성 생식기관 정독', null, null], ['김진우p 골반 발표 새 문제(원문·변형 26)', ['J6', 'J2'], 'unsolved'],")
open(out, 'w', encoding='utf-8').write(h)
print('ok', len(BL), 'images', len(DK), 'decks')
