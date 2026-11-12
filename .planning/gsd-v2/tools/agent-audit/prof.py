from common import *
import sys
def prof(name):
    r=[r for r in R if bn(r)==name][0]; ev=P[r['path']]
    print('=====',name,r['meta'].get('description'),r['meta'].get('model'),'ctx',r['max_ctx'],'min',round((r['t1']-r['t0'])/60))
    print('prompt:',(r.get('first_prompt') or '')[:500].replace('\n',' '))
    tus=[e for e in ev if e[0]=='tu']
    print('tools',collections.Counter(e[1] for e in tus).most_common(8),'compactions',sum(1 for e in ev if e[0]=='compact')//2)
    # bash classes
    cm=collections.Counter()
    for e in tus:
        if e[1]=='Bash':
            c=e[2]['cmd'].strip().split('\n')[0][:60]; cm[re.sub(r'[0-9a-f]{7,}','H',c)[:40]]+=1
    print('top bash',cm.most_common(6))
    big=[(e[2],e[1]) for e in ev if e[0]=='tr' and e[2]>=20000]
    print('big results',len(big),sum(b for b,_ in big))
    # timeline of text snippets
    ts=[(i,e[1][:200].replace('\n',' ')) for i,e in enumerate(ev) if e[0]=='text']
    for i,t in ts[:3]+ts[len(ts)//2:len(ts)//2+1]+ts[-3:]: print(' T',i,t)
    for i,e in enumerate(ev):
        if e[0]=='compact': print(' compact at event',i,'of',len(ev))
for n in sys.argv[1:]: prof(n)
