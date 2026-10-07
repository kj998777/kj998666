"""Build 예상문제 JSON (same schema as the JB 채점기 'q' items) from the study markdown files."""
import json, re, sys
from pathlib import Path

D = Path(sys.argv[1])          # study dir
OUT = Path(sys.argv[2])
CIRC = '①②③④⑤⑥⑦⑧⑨⑩'

def blocks(text):
    """Split a question region into {num: text} by '**N.**' markers."""
    parts = re.split(r'\*\*(\d+)\.\*\*', text)
    out = {}
    for i in range(1, len(parts), 2):
        out[int(parts[i])] = parts[i + 1].strip()
    return out

def answers(text):
    out = {}
    for line in text.splitlines():
        m = re.match(r'^(\d+)\.\s+(.*)$', line.strip())
        if m:
            out[int(m.group(1))] = m.group(2).strip()
    return out

def clean(t):
    t = re.sub(r'\*\*', '', t)
    t = re.sub(r'\n?-{3,}\s*$', '', t.strip())
    t = re.sub(r'\n#+ .*$', '', t, flags=re.S)          # trailing section headers
    return t.strip()

def nchoices(q):
    found = [CIRC.index(c) + 1 for c in CIRC if c in q]
    return max(found) if found else 0

def split_ans(a):
    """'③ — 해설' -> ('③', '해설'); 'term / term2 — 해설' -> (...)."""
    if ' — ' in a:
        d, x = a.split(' — ', 1)
    else:
        d, x = a, ''
    return d.strip(), x.strip()

def accepted(d):
    """Accepted strings for a single-blank short answer, or None if it needs self-judging."""
    if re.search(r'[/,;·]|\d\)|\+', d) or len(d) > 45:
        return None
    alts = {d}
    m = re.match(r'^(.*?)\s*\((.*?)\)\s*$', d)
    if m:
        alts.add(m.group(1).strip())
        inner = m.group(2).strip()
        if len(inner) >= 4 and inner.lower() not in ('positive', 'negative'):
            alts.add(inner)
    for s in list(alts):
        alts.add(s.replace('ligament', 'lig.'))
    return sorted(a for a in alts if a)

MULTI = re.compile(r'1\)|두 |세 |네 |두 가지|세 가지|각각|모두|와 |과 |및|,|·')

def make(qid, c, g, s, qtext, ans, extra_is=''):
    qtext = clean(qtext)
    full = re.sub(r'\*\*', '', ans).strip()
    d, x = split_ans(full)
    n = nchoices(qtext)
    item = {'id': qid, 'c': c, 'g': g, 's': s, 'es': 'pred', 'cf': 'high', 'is': extra_is,
            'v': 'agree', 'vr': '', 'ni': 0, 'tx': qtext}
    first = d[:1]
    if n >= 2 and first in CIRC:
        item.update(t='mcq', n=n, a=[CIRC.index(first) + 1], bl=[], d=d, x=x or ('정답 ' + d))
        return item
    stem = qtext.split('\n')[0] if '\n' in qtext and n else qtext
    acc = None if MULTI.search(stem.split('?')[0][-60:] if '?' in stem else stem) else accepted(d)
    if acc:
        item.update(t='short', n=0, a=[acc], bl=['답'], d=d, x=x or d)
    else:
        item.update(t='short', n=0, a=[[d]], bl=['답'], d=full, x=x or full)
        item['is'] = '서술형 — 정답과 비교해 직접 판정' + (' · ' + extra_is if extra_is else '')
    return item

Q = []

# ---------- 김정태p PPT 기반 ----------
kt = (D / '김정태p_PPT기반_예상문제.md').read_text()
qpart, apart = kt.split('## 정답 및 해설', 1)
qs, ans = blocks(qpart), answers(apart)
sec_of = {}
for m in re.finditer(r'^## ([A-E])\. (.*)$', qpart, flags=re.M):
    pass
sections = [(m.start(), m.group(1), m.group(2)) for m in re.finditer(r'^## ([A-E])\. (.*)$', qpart, flags=re.M)]
code = {'A': 'K1', 'B': 'K2', 'C': 'K3', 'D': 'K4', 'E': 'K5'}
for num in sorted(qs):
    pos = qpart.index(f'**{num}.**')
    sec = [s for s in sections if s[0] < pos][-1]
    Q.append(make(91000 + num, code[sec[1]], sec[2].split('(')[0].strip(), f'김정태p PPT 기반 예상 {num}번', qs[num], ans[num]))

# ---------- 김진우p 학생발표 ----------
kj = (D / '김진우p_학생발표기반_예상문제.md').read_text()
qpart, apart = kj.split('## 정답 및 해설', 1)
qs, ans = blocks(qpart), answers(apart)
for num in sorted(qs):
    t = qs[num]
    m = re.match(r'\[(원문|변형)[^·\]]*·\s*([^,\]]+)', t)
    kind, topic = (m.group(1), m.group(2).strip()) if m else ('변형', '상지')
    c = 'J1' if kind == '원문' else 'J2'
    s = ('학생발표 원문' if kind == '원문' else '학생발표 변형') + f' · {topic}'
    Q.append(make(92000 + num, c, topic, s, t, ans[num]))

# ---------- 교수님별_예상문제.md (스타일 기반 문항) ----------
mn = (D / '교수님별_예상문제.md').read_text()
sec2 = mn.split('## 2. 예상문제', 1)[1].split('## 3. 예상문제', 1)[0]
sec3 = mn.split('## 3. 예상문제', 1)[1].split('## 4. 예상문제', 1)[0]
sec4 = mn.split('## 4. 예상문제', 1)[1].split('## 5. 정답 및 해설', 1)[0]
anspart = mn.split('## 5. 정답 및 해설', 1)[1]
a2 = answers(anspart.split('### 윤상필p', 1)[1].split('### 김정태p', 1)[0])
a3 = answers(anspart.split('### 김정태p', 1)[1].split('### 김진우p', 1)[0])
a4 = answers(anspart.split('### 김진우p', 1)[1].split('## 6.', 1)[0])

# section 2: 1~7 연계 문항 텍스트는 '**5~7. (연계)**'라서 blocks가 못 잡음 -> 공통 지문을 앞에 붙인다
s2 = sec2
lead57 = re.search(r'\*\*5~7\. \(연계\)\*\*(.*?)\n\*\*5\.\*\*', s2, flags=re.S)
q2 = blocks(s2)
for k in (5, 6, 7):
    if lead57:
        q2[k] = clean(lead57.group(1)) + '\n\n' + q2[k]
for num in sorted(q2):
    Q.append(make(91100 + num, 'K6', '실습·임상 주관식', f'윤상필p 스타일(실습 카땡 대비) {num}번', q2[num], a2[num]))

q3 = blocks(sec3)
for num in sorted(q3):
    c = 'K5' if num in (13, 14) else 'J3'
    who = '김정태p 범위' if c == 'K5' else '김진우p 범위'
    Q.append(make(92100 + num, c, '상지 조합형' if c == 'J3' else '가슴벽', f'{who} · 조합형 예상 {num}번', q3[num], a3[num]))

q4 = blocks(sec4)
for num in sorted(q4):
    Q.append(make(92200 + num, 'J4', '총론·등', f'김진우p 총론·등 예상 {num}번', q4[num], a4[num]))

# ---------- 윤상필p (길라잡이 기반, 있으면) ----------
ys = D / '윤상필p_길라잡이기반_예상문제.md'
if ys.exists():
    t = ys.read_text()
    qpart, apart = t.split('## 정답 및 해설', 1)
    qs, ans = blocks(qpart), answers(apart)
    sections = [(m.start(), m.group(1), m.group(2)) for m in re.finditer(r'^## ([A-Z])\. (.*)$', qpart, flags=re.M)]
    ycode = {'A': 'Y1', 'B': 'Y2', 'C': 'Y3', 'D': 'Y4', 'E': 'Y5'}
    for num in sorted(qs):
        pos = qpart.index(f'**{num}.**')
        sec = [s for s in sections if s[0] < pos][-1]
        Q.append(make(93000 + num, ycode[sec[1]], sec[2].split('(')[0].strip(), f'윤상필p 길라잡이 기반 {num}번', qs[num], ans[num]))


OVR = {
    91003: ['adductor tubercle', '모음근결절'],
    91012: ['serratus anterior m.', '앞톱니근'],
    91017: ['suprascapular n.', '어깨위신경'],
    91028: ['pectineus m.', '두덩근'],
    91040: 'essay', 91122: 'essay',
    91046: ['tibialis anterior m.', '앞정강근'],
    91051: ['soleus m.', '가자미근'],
    91052: ['5~10%', '5-10%', '5~10', '5-10'],
    91053: ['popliteus m.', '오금근'],
    91056: ['안쪽복사 주변', '안쪽복사', '안쪽복사 주위', 'medial malleolus'],
    91060: ['deep fibular n.', 'deep peroneal n.', '깊은종아리신경'],
    91079: ['diaphragm', '가로막'],
    91102: ['mid-inguinal point', 'midinguinal point', '샅중간점', 'ASIS와 두덩결합의 중간점'],
    91109: ['short head of biceps femoris m.', 'biceps femoris short head', '넙다리두갈래근 짧은갈래'],
    91117: ['iliofemoral ligament', 'iliofemoral lig.', 'Y ligament of Bigelow', '엉덩넙다리인대'],
    91127: ['L4', 'L4 가시돌기', 'supracristal plane', '넷째 허리뼈', 'L4 spinous process'],
    92206: ['L5', 'L5 신경뿌리', 'L5 nerve root', 'L5 뿌리'],
}
for q in Q:
    o = OVR.get(q['id'])
    if o == 'essay':
        q['a'] = [[q['d']]]
        q['is'] = '서술형 — 정답과 비교해 직접 판정'
    elif o:
        q['a'] = [o]
        q['is'] = ''

regions = {'K': '김정태p (하지·가슴)', 'J': '김진우p (상지·등·학생발표)'}
subs = {'K1': '골학(다리뼈·가슴우리뼈)', 'K2': '넙다리·볼기', 'K3': '종아리·발', 'K4': '다리의 관절', 'K5': '가슴우리·가슴벽',
        'K6': '실습·임상 주관식(카땡 대비)',
        'J1': '학생발표 문제 원문', 'J2': '학생발표 문제 변형', 'J3': '상지 조합형', 'J4': '총론·등'}
if any(q['c'][0] == 'Y' for q in Q):
    regions['Y'] = '윤상필p (배·총론 · 길라잡이)'
    subs.update({'Y1': '총론', 'Y2': '배벽·샅굴', 'Y3': '복막·창자', 'Y4': '소화기 부속샘', 'Y5': '길라잡이 기타'})

ids = [q['id'] for q in Q]
assert len(ids) == len(set(ids)), 'duplicate ids'
missing = [q['id'] for q in Q if not q['x'] or q['x'] == '(해설 없음)']
OUT.write_text(json.dumps({'regions': regions, 'subs': subs, 'q': Q}, ensure_ascii=False))
from collections import Counter
print(len(Q), Counter(q['c'] for q in Q), Counter(q['t'] for q in Q),
      'essay', sum('서술형' in q['is'] for q in Q), 'no-exp', missing)
