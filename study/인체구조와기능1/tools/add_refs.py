"""Attach PPT page references (rf) to prediction questions.

rf = [[book_key, page], ...]  (page = 1-based PDF page of that PPT PDF)
"""
import json, re, subprocess, sys
from pathlib import Path

pred_path, up = Path(sys.argv[1]), Path(sys.argv[2])
FILES = {  # key: (glob in uploads, label)
    'KO': '67e04702-*', 'K1': 'eb693876-*', 'K2': '6de499de-*', 'K3': 'ea0cb1e9-*', 'K4': 'afc2f29d-*', 'KT': '8dfa5399-*', 'KH': '9a1b14ee-*',
    'SA': 'f319a673-*', 'SB': 'bb44e2e7-*', 'SC': 'a5546b12-*', 'SD': '1b51f06c-*',
}
pages = {}
for k, g in FILES.items():
    f = next(up.glob(g))
    txt = subprocess.run(['pdftotext', '-layout', str(f), '-'], capture_output=True, text=True).stdout
    pages[k] = [re.sub(r'\s+', ' ', p).lower() for p in txt.split('\f')]

# student decks: presenter slide ranges by topic prefix
DECK = [
    ('복장빗장', 'SA', 1, 5), ('봉우리빗장', 'SA', 6, 12), ('어깨관절', 'SA', 13, 19), ('팔꿉', 'SA', 20, 25),
    ('노자', 'SA', 26, 28), ('손목관절', 'SA', 29, 35), ('손의 관절', 'SA', 36, 41),
    ('팔오금', 'SC', 1, 5), ('아래팔 앞칸', 'SC', 6, 10), ('아래팔 뒤칸', 'SC', 11, 16), ('아래팔 동맥', 'SC', 17, 22),
    ('아래팔의 신경', 'SC', 23, 29), ('손바닥의 근막', 'SC', 30, 35), ('손의 근육', 'SC', 36, 43), ('손의 동맥', 'SC', 44, 49),
    ('손의 신경', 'SC', 50, 60),
    ('팔의 피부신경', 'SD', 1, 5), ('얕은정맥', 'SD', 6, 11), ('앞 몸통팔', 'SD', 12, 16), ('뒤 몸통팔', 'SD', 17, 21),
    ('겨드랑동맥', 'SD', 22, 25), ('겨드랑정맥', 'SD', 26, 30), ('겨드랑림프절', 'SD', 26, 30), ('팔신경얼기', 'SD', 31, 35),
    ('위팔의 근육', 'SD', 36, 44), ('위팔의 혈관', 'SD', 45, 52), ('위팔의 신경', 'SD', 53, 60),
]
STOP = set('the and of with from that this which into 다음 설명 옳은 옳지 않은 것은 모두 고른 것을 쓰시오 무엇인가 대한 으로 에서 하는 있는 이다'.split())

def toks(s):
    s = s.lower()
    en = set(re.findall(r'[a-z]{5,}', s))
    ko = set(w for w in re.findall(r'[가-힣]{3,}', s))
    return {t for t in en | ko if t not in STOP}

def best(q, keys, top=2):
    tk = toks(q['tx'] + ' ' + q['d'] + ' ' + q.get('x', ''))
    scored = []
    for k in keys:
        for i, p in enumerate(pages[k]):
            sc = sum(1 for t in tk if t in p)
            if sc:
                scored.append((sc, k, i + 1))
    scored.sort(reverse=True)
    if not scored or scored[0][0] < 3:
        return []
    out, seen = [], set()
    for sc, k, p in scored:
        if sc < max(3, scored[0][0] * 0.6) or len(out) >= top:
            break
        if (k, p) not in seen:
            seen.add((k, p)); out.append([k, p])
    return out

MANUAL = {91386: [3], 91387: [4], 91388: [4], 91389: [5], 91394: [10], 91399: [17], 91401: [21, 22],
          91402: [23], 91410: [35], 91414: [42, 43], 91419: [53]}
d = json.loads(pred_path.read_text())
stats = {'deck': 0, 'match': 0, 'none': 0}
for q in d['q']:
    rf = []
    if q['c'] in ('J1', 'J2'):
        for pre, k, a, b in DECK:
            if q['g'].startswith(pre):
                rf = [[k, p] for p in range(a, b + 1)]
                break
        stats['deck' if rf else 'none'] += 1
    elif q['c'][0] == 'K':
        rf = best(q, ['KO', 'K1', 'K2', 'K3', 'K4', 'KT', 'KH'])
        stats['match' if rf else 'none'] += 1
    elif q['c'] == 'J3':
        rf = best(q, ['SA', 'SB', 'SC', 'SD'])
        stats['match' if rf else 'none'] += 1
    else:
        stats['none'] += 1
    if not rf and q['id'] in MANUAL:
        rf = [['KH', n] for n in MANUAL[q['id']]]
    q['rf'] = rf
pred_path.write_text(json.dumps(d, ensure_ascii=False))
print(stats)
for q in d['q'][:3] + [x for x in d['q'] if x['id'] in (91022, 91062, 91078, 92103, 92109)]:
    print(q['id'], q['g'], q['rf'])
