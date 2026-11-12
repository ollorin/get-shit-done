import sys; sys.path.insert(0,'.')
from lib import *
R=load(); sw=json.load(open('out/sweep_active.json'))
A=collections.defaultdict(lambda:[0,0.0,0.0,0,0,0.0,0.0])
for r in R:
    a=activity(r); t=tokens(r); x=A[a]; x[0]+=1; x[1]+=r['active']/3600; x[2]+=r['tool_time']/3600; x[3]+=t[2]; x[4]+=t[3]; x[5]+=t[4]
tu=sum(x[5] for x in A.values()); sb=sum(sw['share'].values())
leafh=sum(x[1] for a,x in A.items() if a not in('coordinator','main-orchestrator'))
print('| activity | spawns | active agent-h | % of leaf agent-h | share of busy wall-clock (concurrency-weighted) | cache-read M | output M | est $ | % of $ |')
print('|---|---|---|---|---|---|---|---|---|')
for a,x in sorted(A.items(),key=lambda kv:-kv[1][5]):
    leaf=a not in('coordinator','main-orchestrator')
    print('| %s | %d | %.0f | %s | %s | %.0f | %.1f | %.0f | %.1f%% |'%(a,x[0],x[1],'%.1f%%'%(100*x[1]/leafh) if leaf else '-', '%.1f%%'%(100*sw['share'].get(a,0)/sb) if leaf else '-',x[3]/1e6,x[4]/1e6,x[5],100*x[5]/tu))
print('leaf active h',round(leafh),'busy wall h',round(sw['busy_h']),'of',round(sw['window_h']),'mean conc',round(sw['conc_mean'],2))
