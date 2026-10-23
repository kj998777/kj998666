"""실습리뷰 PDF → 땡시 「사진으로 공부하기」용 가벼운 PDF + 검색 목록

문제(핀)로 만들지 않은 사진까지 볼 수 있게, 조별 실습리뷰를 쪽 그대로(사진 + 학생들이 적은 화살표·설명) 보여 준다.
- 각 쪽을 폭 1400px JPEG(q55)로 다시 그려 새 PDF로 저장 (원본 수십 MB → 수 MB)
- 쪽마다 글자를 뽑아 검색 목록(rv_index.json)에 넣고, 낱말로 부위(등·상지·하지·가슴·배·골반)를 정함
- 제목에서 주차·조를 읽고, stations.json의 주차별 조 → 카데바 번호표로 카데바를 붙임

usage: python3 -I rv_build.py <pdf_dir> <drive_list.json> <stations.json> <out_dir>
  drive_list.json: [{id, title, ...}] (드라이브 검색 결과), 파일 이름은 <id>.pdf
  결과 PDF와 목록은 저장소에 올리지 않는다(학생 실습리뷰·카데바 사진).
"""
import json, re, sys, unicodedata
from pathlib import Path
import pymupdf

PDF, LIST, STA, OUT = map(Path, sys.argv[1:5])
OUT.mkdir(parents=True, exist_ok=True)
files = {f['id']: f for f in json.loads(LIST.read_text())}
sta = json.loads(STA.read_text())
CADS = {int(w['id'][1:]): {int(g): c for g, c in (w.get('cads') or {}).items()} for w in sta['weeks']}
for w in sta['weeks']:            # 1주차처럼 cads 표가 비어 있으면 정거장의 조 → 카데바로 채움
    for st in w['stations']:
        if st.get('cad'): CADS[int(w['id'][1:])].setdefault(int(st['g']), st['cad'])
# 제목에 주차가 없으면 실습 날짜(26MMDD)로: 9/3 1주차부터 일주일 간격
def week_of_date(t):
    m = re.search(r'26(\d\d)(\d\d)', t)
    if not m: return None
    import datetime
    d = datetime.date(2026, int(m.group(1)), int(m.group(2)))
    return (d - datetime.date(2026, 9, 1)).days // 7 + 1

KW = {
  '등': r'등세모|척추|뒤통수|trapez|latissim|rhomboid|erector|suboccip|thoracolumbar|spinous|vertebr|청진삼각|넓은등근|마름근',
  '상지': r'팔|손|겨드랑|어깨|팔꿉|노신경|자신경|정중신경|빗장|세모근|두갈래근|세갈래근|brachi|axill|radial|ulnar|median|humer|forearm|hand|palm|cubital|deltoid|biceps|triceps|cephalic|basilic|scapul|clavic|pectoral|breast|유방',
  '하지': r'샅고랑|고샅|넙다리|다리|종아리|발|무릎|볼기|오금|정강|두렁|궁둥|모음근|장딴지|가자미|복사|femor|thigh|\bleg\b|foot|pedis|plantar|knee|patell|glute|poplit|sciatic|tibia|fibula|saphenous|sartorius|gracilis|adductor|hamstring|gastrocnem|soleus|calcane|hallucis|malleol',
  '가슴': r'가슴|심장|심방|심실|허파|갈비|세로칸|대동맥|식도|heart|lung|pulmon|cardi|coronar|aort|intercost|thorac|pleur|pericard|phrenic|\brib|costal|stern|mediastin|atri|ventric',
  '배': r'배벽|복막|창자|이자|지라|콩팥|쓸개|막창자|잘록|샘창자|그물막|간문맥|위장|peritone|abdomin|stomach|gastr|hepat|liver|pancrea|splen|kidney|renal|colon|cecum|duoden|jejun|ileum|omentum|mesenter|gall|rectus abdominis|umbilic',
  '골반': r'골반|회음|방광|곧창자|자궁|난소|전립|고환|음경|음낭|pelvi|perine|bladder|rectum|uter|ovar|prostat|testi|penis|scrot|pudend',
}
WEEK = {1: ['등'], 2: ['상지', '가슴'], 3: ['상지', '하지', '등'], 4: ['하지'], 5: ['하지', '가슴', '상지'], 6: ['가슴', '배'], 7: ['배'], 8: ['골반', '배']}

def region(week, text):
    c = WEEK.get(week, list(KW))
    if len(c) == 1: return c[0]
    t = text.lower()
    sc = {r: len(re.findall(KW[r], t)) for r in c}
    best = max(c, key=lambda r: sc[r])
    return best if sc[best] else None   # 낱말이 없으면 앞뒤 쪽을 따라감

index = []
for p in sorted(PDF.glob('*.pdf')):
    fid = p.stem
    meta = files.get(fid)
    if not meta: continue
    title = unicodedata.normalize('NFC', meta['title']).replace('.pdf', '').strip()
    mw, mg, mc = re.search(r'(\d+)\s*주차', title), re.search(r'(\d+)\s*조', title), re.search(r'(\d+)\s*번\s*카데바', title)
    week = int(mw.group(1)) if mw else week_of_date(title)
    g = int(mg.group(1)) if mg else None
    cad = int(mc.group(1)) if mc else (CADS.get(week, {}).get(g) if week and g else None)
    try:
        src = pymupdf.open(p)
    except Exception as e:
        print('skip', title, e); continue
    dst = pymupdf.open()
    pages = []
    for i, pg in enumerate(src):
        z = 1400 / max(pg.rect.width, 1)
        pix = pg.get_pixmap(matrix=pymupdf.Matrix(z, z))
        jpg = pix.tobytes('jpeg', jpg_quality=55)
        npg = dst.new_page(width=pg.rect.width, height=pg.rect.height)
        npg.insert_image(npg.rect, stream=jpg)
        t = unicodedata.normalize('NFC', re.sub(r'\s+', ' ', pg.get_text()).strip())
        pages.append({'n': i + 1, 'img': len(pg.get_images()) > 0, 't': t[:1500], 'r': region(week, title + ' ' + t)})
    # 부위 낱말이 없는 쪽은 바로 앞(없으면 뒤) 쪽의 부위를 따름
    last = None
    for x in pages:
        if x['r']: last = x['r']
        elif last: x['r'] = last
    for x in reversed(pages):
        if x['r']: last = x['r']
        elif last: x['r'] = last
    for x in pages:
        if not x['r']: x['r'] = (WEEK.get(week) or ['기타'])[0]
    out = OUT / f'rv-{fid}.pdf'
    dst.save(out, garbage=4, deflate=True)
    index.append({'id': fid, 'title': title, 'week': week, 'g': g, 'cad': cad, 'n': len(pages), 'kb': out.stat().st_size // 1024, 'pages': pages})
    print(f"{out.stat().st_size / 1e6:5.1f}MB  {len(pages):3d}p  w{week} g{g} c{cad}  {title}")
(OUT / 'rv_index.json').write_text(json.dumps(index, ensure_ascii=False))
print(len(index), 'reviews', sum(x['n'] for x in index), 'pages', sum((OUT / f"rv-{x['id']}.pdf").stat().st_size for x in index) // 1e6, 'MB')
