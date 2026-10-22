"""김정태p PPT 기반 예상문제에 해설 근거 슬라이드 캡처를 붙인다.

usage: python3 -I mk_kjt_media.py <pred.json> <uploads_dir> <out_img_dir> <kjw_media.json>
  문항(정답·해설·문제 글)과 강의 PDF 각 쪽의 글자를 맞춰(드문 용어일수록 가중치 큼) 가장 잘 맞는 1~2쪽을 고른다.
  결과는 kjw_media.json(문항 id -> {xi:[{f,cap}]})에 합쳐 쓴다. 캡처 이미지는 저장소에 올리지 않는다.
"""
import json, math, re, sys
from collections import Counter
from pathlib import Path
import pymupdf

PRED, UP, OUT, MEDIA = sys.argv[1:5]
UP, OUT = Path(UP), Path(OUT)
OUT.mkdir(parents=True, exist_ok=True)

DECKS = {   # key: (파일 이름 일부, 캡션)
    'os': ('Osteology_Lower_limb_260916', '골학(하지) 강의'),
    'l1': ('20260916_Lower_limb_I', 'Lower limb I 강의'),
    'l2': ('20260917_Lower_limb_II', 'Lower limb II 강의'),
    'l3': ('20260923_Lower_limb_III', 'Lower limb III 강의'),
    'l4': ('20260930_Lower_limb_IV', 'Lower limb IV 강의'),
    'tc': ('20261001_Thoracic_cage', 'Thoracic cage 강의'),
    'hl': ('20261007_Heart_lung', 'Heart·lung 강의'),
}
BY_SUB = {'K1': ['os', 'tc'], 'K2': ['l1', 'l2', 'os'], 'K3': ['l2', 'l3', 'l4', 'os'], 'K4': ['l1', 'l3', 'l4', 'os'],
          'K5': ['tc'], 'K7': ['hl']}
STOP = set('that this with from which when what have into they there their than then also only each other most more less over under between both after before about these those does were been being such some very much many used same into onto'.split())

def path_of(part):
    return next(p for p in UP.iterdir() if part in p.name and p.suffix == '.pdf')

def en_terms(s):
    return [w for w in re.findall(r'[a-z]{4,}', s.lower()) if w not in STOP]

def ko_terms(s):
    t = re.sub(r'[^가-힣]', '', s)
    return [t[i:i + 3] for i in range(len(t) - 2)]

def terms(s):
    return en_terms(s) + ko_terms(s)

docs, pages, TXT = {}, [], {}   # pages: (deck, page no, Counter)
for k, (part, _) in DECKS.items():
    d = pymupdf.open(path_of(part)); docs[k] = d
    for i, pg in enumerate(d):
        tx = pg.get_text(); TXT[(k, i + 1)] = re.sub(r'\s+', '', tx)
        pages.append((k, i + 1, Counter(terms(tx))))
N = len(pages)
df = Counter()
for _, _, c in pages:
    df.update(set(c))
idf = {t: math.log(N / (1 + n)) for t, n in df.items()}

def render(k, n):
    name = f'kjt-{k}-{n}.jpg'
    p = OUT / name
    if not p.exists():
        pg = docs[k][n - 1]
        z = 1300 / pg.rect.width
        pg.get_pixmap(matrix=pymupdf.Matrix(z, z)).save(p, jpg_quality=72)
    return name

pred = json.loads(Path(PRED).read_text())
media = json.loads(Path(MEDIA).read_text()) if Path(MEDIA).exists() else {}
stats = Counter()
for q in pred['q']:
    if not (91001 <= q['id'] <= 91099 or 91301 <= q['id'] <= 91499) or q['c'] not in BY_SUB:
        continue
    want = Counter()
    for t in terms(q['tx']): want[t] += 1
    for t in terms(q['d'] + ' ' + q['x']): want[t] += 2
    cand = []
    for k, n, c in pages:
        if k not in BY_SUB[q['c']]:
            continue
        sc = sum(min(w, 3) * idf.get(t, 0) for t, w in want.items() if t in c)
        cand.append((sc, k, n))
    cand.sort(reverse=True)
    if not cand or cand[0][0] < 12:
        stats['none'] += 1
        continue
    top = cand[0][0]
    pick = [c for c in cand[:2] if c[0] >= top * 0.7]
    if len(pick) == 2 and TXT[pick[0][1:]] == TXT[pick[1][1:]]:
        pick = pick[:1]                     # 같은 슬라이드가 두 강의에 반복된 경우
    pick.sort(key=lambda c: (list(DECKS).index(c[1]), c[2]))
    media[str(q['id'])] = {'xi': [{'f': render(k, n), 'cap': f'{DECKS[k][1]} {n}쪽'} for _, k, n in pick]}
    stats[len(pick)] += 1

Path(MEDIA).write_text(json.dumps(media, ensure_ascii=False, indent=1))
print(dict(stats), len(list(OUT.glob('kjt-*.jpg'))), 'images',
      sum(f.stat().st_size for f in OUT.glob('kjt-*.jpg')) // 1024, 'KB')
