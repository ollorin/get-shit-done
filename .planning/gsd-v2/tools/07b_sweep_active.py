import sys; sys.path.insert(0,'.')
from lib import *
R=load()
t_min=int(min(r['t0'] for r in R)//60); t_max=int(max(r['t1'] for r in R)//60)+1
N=t_max-t_min
leaf=[r for r in R if activity(r) not in('coordinator','main-orchestrator')]
def mins(r):
    a=int(r['t0']//60); b=int(r['t1']//60)
    s=set(range(a,b+1))
    for st,du in r['idle_gaps']:
        for m in range(int(st//60)+1,int((st+du)//60)): s.discard(m)
    return [m-t_min for m in s]
M=[(r,mins(r)) for r in leaf]
conc=[0]*N
for r,ms in M:
    for m in ms: conc[m]+=1
share=collections.defaultdict(float)
for r,ms in M:
    a=activity(r)
    for m in ms: share[a]+=1.0/conc[m]
busy=sum(1 for c in conc if c>0)
print('active-gap-adjusted: busy min',busy,'=',round(busy/60),'h =',round(100*busy/N,1),'% of',round(N/60),'h window; mean concurrency when busy %.2f'%(sum(conc)/busy))
tot=sum(share.values())
json.dump({'busy_h':busy/60,'window_h':N/60,'share':{k:v/60 for k,v in share.items()},'conc_mean':sum(conc)/busy},open('out/sweep_active.json','w'))
for a,v in sorted(share.items(),key=lambda x:-x[1]): print('%-24s %7.1f busy-h  %5.1f%%'%(a,v/60,100*v/tot))
# days with zero activity (limit stalls)
d=collections.Counter()
for i,c in enumerate(conc):
    if c>0: d[day((t_min+i)*60)]+=1
print(sorted((k,round(v/60,1)) for k,v in d.items()))
