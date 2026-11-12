import sys; sys.path.insert(0,'.')
from lib import *
R=load()
t_min=int(min(r['t0'] for r in R)//60); t_max=int(max(r['t1'] for r in R)//60)+1
N=t_max-t_min
conc=[0]*N
leaf=[r for r in R if activity(r) not in('coordinator','main-orchestrator')]
for r in leaf:
    a=int(r['t0']//60)-t_min; b=int(r['t1']//60)-t_min
    for m in range(a,b+1): conc[m]+=1
share=collections.defaultdict(float)
# second pass: fractional
for r in leaf:
    a=int(r['t0']//60)-t_min; b=int(r['t1']//60)-t_min; act=activity(r)
    for m in range(a,b+1): share[act]+=1.0/conc[m]
busy=sum(1 for c in conc if c>0)
print('window minutes',N,'=',round(N/60/24,1),'days; busy (>=1 leaf agent) min',busy,'=',round(busy/60),'h =',round(100*busy/N,1),'%')
print('mean concurrency when busy',round(sum(conc)/busy,2),'max',max(conc))
# concurrency histogram
h=collections.Counter(min(c,10) for c in conc if c>0)
print(sorted(h.items()))
tot=sum(share.values())
for a,v in sorted(share.items(),key=lambda x:-x[1]): print('%-24s %7.1f busy-h  %5.1f%%'%(a,v/60,100*v/tot))
# per day busy hours
d=collections.Counter()
for i,c in enumerate(conc):
    if c>0: d[day((t_min+i)*60)]+=1
print(sorted((k,round(v/60,1)) for k,v in d.items()))
# also coordinators/main active (any agent incl coordinator)
conc2=[0]*N
for r in R:
    if r['kind']=='top' and not r['proj'].endswith('charlotte'): continue
    a=int(r['t0']//60)-t_min; b=int(r['t1']//60)-t_min
    for m in range(a,b+1): conc2[m]+=1
print('any non-main agent busy h',round(sum(1 for c in conc2 if c>0)/60))
