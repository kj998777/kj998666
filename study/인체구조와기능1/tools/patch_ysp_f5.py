"""채점기: 콩팥·부신·뒤배벽(F5)을 윤상필p 정식 범위로 (애매한 단원 → 범위 안)

usage: python3 -I patch_ysp_f5.py <page.html> <out.html>
"""
import sys
src, out = sys.argv[1:3]
h = open(src, encoding='utf-8').read()
old = "{n:'윤상필p', w:'약 20%', what:'총론, 배벽, 창자, 소화기 부속샘', jb:['A1','A2','A3','F1','F2','F3','F4','F6'], maybe:['F5'],"
new = "{n:'윤상필p', w:'약 20%', what:'총론, 배벽, 창자, 소화기 부속샘, 콩팥·부신·뒤배벽', jb:['A1','A2','A3','F1','F2','F3','F4','F5','F6'], maybe:[],"
assert h.count(old) == 1
h = h.replace(old, new)
old2 = ", F5:'콩팥·부신·뒤배벽 — 계획서에 콩팥 강의 없음(뒤배벽만 배벽 강의에 포함 가능)'}"
assert h.count(old2) == 1
h = h.replace(old2, '}')   # 애매한 단원 목록에서 빼기
open(out, 'w', encoding='utf-8').write(h)
print('ok')
