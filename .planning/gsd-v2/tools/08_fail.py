import sys; sys.path.insert(0,'.')
from lib import *
from datetime import datetime
R=load()
def ep(ts): return datetime.fromisoformat(ts[:-1]+'+00:00').timestamp()
ev=collections.defaultdict(list)
for r in R:
    for ts,k in r['api_err_list']: ev[k].append((ep(ts),role(r)))
for k,L in ev.items():
    L.sort()
    eps=[]; cur=[L[0][0],L[0][0],0,set()]
    for t,ro in L:
        if t-cur[1]>3*3600: eps.append(cur); cur=[t,t,0,set()]
        cur[1]=t; cur[2]+=1; cur[3].add(ro)
    eps.append(cur)
    print('==',k,len(L),'events',len(eps),'episodes')
    for e in eps[:30]: print('  ',datetime.utcfromtimestamp(e[0]).strftime('%m-%d %H:%M'),'->',datetime.utcfromtimestamp(e[1]).strftime('%m-%d %H:%M'),'span h %.1f'%((e[1]-e[0])/3600),'n',e[2],sorted(e[3])[:4])
# transcripts ended by api error
c=collections.Counter()
for r in R:
    if r.get('ended_err'):
        ks=[k for ts,k in r['api_err_list']]
        c[(role(r),ks[-1] if ks else '?')]+=1
print(c.most_common(20))
# compaction
print('compact_boundary',sum(r['api_errors'].get('compact_boundary',0) for r in R), 'files with compaction',sum(1 for r in R if r['api_errors'].get('compact_boundary')))
print(collections.Counter(role(r) for r in R if r['api_errors'].get('compact_boundary')).most_common(6))
