from common import *
S=rs('gsd-executor')
def nc(r): return sum(1 for e in P[r['path']] if e[0]=='compact')//2
def hand(r): return any(e[0]=='tu' and 'EXECUTOR-HANDOFF' in (e[2].get('p') or '')+(e[2].get('cmd') or '') and e[1] in('Write','Bash') for e in P[r['path']])
def model(r): return r['meta'].get('model')
tab=collections.defaultdict(lambda:[0,0,0])
for r in S:
    m=model(r); t=tab[m]; t[0]+=1; t[1]+= nc(r)>0; t[2]+=nc(r)
print('model: n, compacted, total compactions',dict(tab))
comp=[r for r in S if nc(r)]
print('compacted n',len(comp),'of which wrote handoff',sum(hand(r) for r in comp),'; non-compacted wrote handoff',sum(hand(r) for r in S if not nc(r)))
print('total compactions',sum(nc(r) for r in S),'transcripts with >=2',sum(1 for r in S if nc(r)>=2))
# compaction wall: events at compaction: tasks completed? count commits before
# what share of transcripts hit max_ctx >=160k
print('max_ctx>=160k',sum(1 for r in S if (r['max_ctx'] or 0)>=160000))
# handoff transcripts: ctx at handoff
h=[r for r in S if hand(r)]
print('handoff writers',len(h),'model',collections.Counter(model(r) for r in h),'final marker interrupt',sum('PLAN INTERRUPTED' in '\n'.join(e[1] for e in P[r['path']] if e[0]=='text') for r in h))
# number of git commits
