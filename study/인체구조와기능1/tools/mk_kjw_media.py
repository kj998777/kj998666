"""김진우p 학생발표 문제에 붙일 슬라이드 캡처(문제 그림·해설 근거 쪽)를 만든다.

usage: python3 -I mk_kjw_media.py <pred.json> <pdf_dir> <out_img_dir> <out_media.json>
  pdf_dir: 드라이브 개별발표 원본을 PDF로 바꾼 파일들 (<drive file id>.pdf)
  캡처 이미지는 저작권 때문에 저장소에 올리지 않고 채점기 artifact 파일(pimg/)로만 배포한다.
"""
import json, re, sys
from pathlib import Path
import pymupdf

PRED, PDFD, OUT, MEDIA = sys.argv[1:5]
PDFD, OUT = Path(PDFD), Path(OUT)
OUT.mkdir(parents=True, exist_ok=True)

# 문항 번호 -> (발표자, drive file id)
DECK = {
    (1, 2): ('성서연', '10u5kaLzcdpJfx9O6331z9xvbqLRc6yYJ'),
    (3, 4): ('임동휘', '1plumNaoMkN-fOQKF6NXyakw7lgU7e14t'),
    (5, 6): ('조효진', '1YUR1RApQZjWFe6P8geaKie4YmsikVYBs'),
    (7, 8): ('김경서', '1X8mEsZNSH9n8vzxJZn_3xSYlp93z9nXj'),
    (9, 10): ('정지민', '10d3C4-WzHilQvoQCYapr34RZC79NWhJR'),
    (11, 12): ('박다은', '1Q0e8IeMheuh2Qdk07hZt1w-Uvt2VHBkX'),
    (15, 16): ('우윤균', '1K6G7IJmUw7Wffn0qYJWBczH7yPvPWAvj'),
    (17, 18): ('허유석', '1t6Tn7jejw6NhOM7onP24M6ZI3dpAbUHY'),
    (19, 20): ('오재혁', '1U9gM9jLy5T8aYlIowPZo_z0q-n-d8XrS'),
    (21, 22): ('김유경', '1uEncYWfvw6qO1yfnHUmjX0PdUTiJiafs'),
    (23, 24): ('Nerves of forearm', '1-GzhV6EB3Spyo0yokqHpa5BJz2WhVDog'),
    (25, 26): ('주성민', '1-lE3kIhWqOKPMJXdlUXBvE2Genu3axEE'),
    (27, 28): ('오준서', '14qgT4pPqapej5gj8OPKBS6OumNSb65Yd'),
    (29, 30): ('김민규', '11_X3b3TXqsM3kThMPJwR6SFlYGezgNZQ'),
    (31, 32, 33): ('김지원', '1x_696x63KPiwTuewreDrPhDTc0AhVacB'),
    (34, 35): ('정유진', '1TGOmc6B_f3wBLlYM68PqmjY0tI4G_W-a'),
    (36, 55): ('이도윤', '1_DXIIIsKnrtl52X370Gg7u_CoSw7JCr_'),
    (37, 53): ('신수은', '1ZTLJ8htltA72R8r5U5cLsCjA4GGkgsTE'),
    (38, 54): ('양지유', '1UlK48GqdQcExMPS65h2djA1u1SGZ5q2o'),
    (39, 40): ('조세현', '1oPpd7Yimd6PPL7_3gaqYcQns9vgTXGbX'),
    (41, 42): ('김찬규', '1_s3wX_innNb9iE4h7gIg-yCZV2Co3rHi'),
    (43, 44): ('홍석훈', '1p1WQtu8tWmnptuzzASE9bseaJkRs91bR'),
    (45, 46): ('김은주', '16H3ZQoIpqSkhhFvOe0Z7f_Yv2h_MyQTH'),
    (47, 48): ('위팔동맥·정맥', '1Sp0R1AWa-gvwfHf16gAV8FolEJWd6VQ8'),
    (49, 50): ('김서현', '1IVqOiPsRDH219mHwY4uOIoMddr29COR6'),
    (51, 76): ('윤예서', '1gdpeM5LOt-ia2gNRD9o9zq0_hcl4QTaU'),
    (52, 77): ('김수완', '12dRfcMBb3Zrr255VB8m3MNULtHA1GZap'),
    (56,): ('정유진', '1hMDSnp9OBTBmdYSVfzqpl4sNzS8z3hS1'),
    (57, 78): ('고동현', '10K6xMwDPNH1dAvkR1ZVAAgLaiDrG8w_s'),
    (58, 79): ('김민성', '1k09rgWim4z-yHTHh-lEJDImLMIQQ9AbL'),
    (59, 80): ('김민석', '1RvHd3SqaYUxOrhpAIxjOYt1AZqShAOrA'),
    (60, 81): ('서현진', '1t5emnPjgdQJEGFc-u1qQNgBujiZiuhY1'),
    (61, 82): ('김동언', '1_Eib_x__eQwVNcZ2pJHGiYgmfaBk6HbD'),
    (62, 83): ('서현석', '1KE1Pohnj7fQRcpV2NTj5z2mmN8QfNj4n'),
    (63, 84): ('이수빈', '1SNy85FjPWQ7EDsGn1UxkQqV55vky2X1Q'),
    (64, 85): ('김민지', '1gV1_jXL4iPMCIKEwQUoKdumac4C1FVXD'),
    (65, 86): ('김채담', '1eStA5b1ArgyVke6ZHSreJX2hqCMVcQDw'),
    (66, 87): ('김도연', '1BUBsK9xe0apFgBTPUQyA9ZLZiNnUHOdy'),
    (67, 88): ('고원진', '1JAqp3NGIhUrsFaN6rgqbQkUuQucmRG49'),
    (68, 89): ('장재석', '1gRQ8czx_Rd5TuGsVrKhOjSnOIbZeSSCq'),
    (70, 91): ('고승연', '1H5Ntd8G7C_4XrL2s506WxBwBKAtPj0a_'),
    (71, 92): ('류현지', '16rLdYMd3Yf84b271RGjjfMn6Sp7Pv9VG'),
    (72, 93): ('고유한', '1Jm1Fy15AV1twwpIV_VJC_fh8aVSMDii9'),
    (75, 96): ('이예준', '164P4DAXYOhs9Q01YkLNUNBDyEVXPSZLE'),
}
# 문제 화면에 붙일 그림: 번호 -> (쪽, 잘라낼 영역(비율 x0,y0,x1,y1))
QIMG = {45: (9, (0, 0.1, 1, 1)), 72: (4, (0.266, 0.118, 0.68, 0.866))}
# 자동 선택 대신 직접 고른 해설 근거 쪽 (글자가 이미지라 자동 선택이 안 되는 발표 등)
PAGES = {7: [3, 4, 5], 8: [4], 45: [4, 8]}
QUIZ = re.compile(r'문제|퀴즈|quiz|Q\s*\.', re.I)

def is_quiz(t):
    return bool(QUIZ.search(t) and re.search(r'옳은|옳지|고르|아닌|틀린|\?', t) and not re.search(r'해설|정답', t))

def render(fid, page, clip=None):
    name = f'{fid}-{page}' + ('q' if clip else '') + '.jpg'
    p = OUT / name
    if not p.exists():
        d = pymupdf.open(PDFD / f'{fid}.pdf')
        pg = d[page - 1]
        r = pg.rect
        kw = {}
        if clip:
            x0, y0, x1, y1 = clip
            kw['clip'] = pymupdf.Rect(r.x0 + r.width * x0, r.y0 + r.height * y0, r.x0 + r.width * x1, r.y0 + r.height * y1)
        zoom = 1300 / r.width
        pix = pg.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), **kw)
        pix.save(p, jpg_quality=72)
    return name

def toks(s):
    s = re.sub(r'\*\*', '', s)
    return {w.lower() for w in re.findall(r'[A-Za-z]{4,}|[가-힣]{2,}', s)}

pred = json.loads(Path(PRED).read_text())
Q = {q['id'] - 92000: q for q in pred['q'] if 92001 <= q['id'] <= 92099}
media = {}
for nums, (who, fid) in DECK.items():
    d = pymupdf.open(PDFD / f'{fid}.pdf')
    texts = [pg.get_text() for pg in d]
    for n in nums:
        q = Q[n]
        m = re.search(r'근거:\s*\S+ 발표 ([\d·]+)쪽', q['x'])
        if n in PAGES:
            pages = PAGES[n]
        elif m:
            pages = [int(x) for x in m.group(1).split('·')]
        else:
            stem = re.sub(r'\s+', '', q['tx'].split('\n')[0])[-20:]
            want = toks(q['x'] + ' ' + q['tx'])
            cand = []
            for i, t in enumerate(texts):
                if i == 0 and len(texts) > 2:
                    continue                          # 표지
                flat = re.sub(r'\s+', '', t)
                if is_quiz(t) or (stem[:12] and stem[:12].lower() in flat.lower() and not re.search(r'해설|정답', t)):
                    continue                          # 문제 슬라이드 자체
                sc = len(want & toks(t))
                if sc:
                    cand.append((sc, i + 1))
            cand.sort(reverse=True)
            pages = sorted(p for _, p in cand[:2])
        xi = [{'f': render(fid, p), 'cap': f'{who} 발표 {p}쪽'} for p in pages if 1 <= p <= len(texts)]
        ent = {'xi': xi}
        if n in QIMG:
            pg, clip = QIMG[n]
            ent['qi'] = [render(fid, pg, clip)]
        media[str(92000 + n)] = ent

Path(MEDIA).write_text(json.dumps(media, ensure_ascii=False, indent=1))
print(len(media), 'questions', len(list(OUT.glob('*.jpg'))), 'images',
      sum(f.stat().st_size for f in OUT.glob('*.jpg')) // 1024, 'KB')
