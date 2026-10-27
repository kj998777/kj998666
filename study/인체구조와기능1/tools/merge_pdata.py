import sys,re,json
raw=open(sys.argv[1],encoding='utf-8').read()
start=raw.index('<!doctype html>\n<html lang="ko">'); h=raw[start:].rstrip()
assert h.endswith('</body></html>'); h=h[:-len('</body></html>')].rstrip()+'\n'
m=re.search(r'(<script id="pdata" type="application/json">)(.*?)(</script>)',h,re.S)
live=json.loads(m.group(2).replace('<\\/','</'))
new=json.load(open('pred.json'))
L={q['id']:q for q in live['q']}
d=0
for q in new['q']:
    o=L.get(q['id'])
    if o:
        for k in o:
            if o[k]!=q.get(k): d+=1; q[k]=o[k]
pd=json.dumps(new,ensure_ascii=False).replace('</','<\\/')
h=h[:m.start(2)]+pd+h[m.end(2):]
open(sys.argv[2],'w',encoding='utf-8').write(h)
print('ok',len(new['q']),'kept live values',d)
