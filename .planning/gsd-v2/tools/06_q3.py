import sys; sys.path.insert(0,'.')
from lib import *
R=load()
# totals & sanity
tot=[sum(tokens(r)[i] for r in R) for i in range(5)]
print('TOTAL tokens M: fresh %.0f cw %.0f cr %.0f out %.0f est$ %.0f'%tuple(x/(1e6 if i<4 else 1) for i,x in enumerate(tot)))
# cost-state of main sessions
print('cost-state total $', sum((r.get('cost') or {}).get('totalCostUSD') or 0 for r in R if r['kind']=='top' and not r['proj'].endswith('charlotte')))
# activity table
A=collections.defaultdict(lambda:[0,0.0,0,0,0,0,0.0,0.0])
for r in R:
    a=activity(r); t=tokens(r)
    x=A[a]; x[0]+=1; x[1]+=wall(r)/3600; x[2]+=t[0]; x[3]+=t[1]; x[4]+=t[2]; x[5]+=t[3]; x[6]+=t[4]; x[7]+=r['tool_time']/3600
leaf=[a for a in A if a not in('coordinator','main-orchestrator')]
Lh=sum(A[a][1] for a in leaf); Ld=sum(A[a][6] for a in A); 
print('leaf agent-hours',round(Lh),'all $',round(Ld))
print('| activity | spawns | agent-h | %leaf-h | tool-wait h | cache-read M | out M | est $ | %$ |')
for a,x in sorted(A.items(),key=lambda kv:-kv[1][6]):
    print('| %s | %d | %.1f | %s | %.1f | %.0f | %.2f | %.0f | %.1f%% |'%(a,x[0],x[1],('%.1f%%'%(100*x[1]/Lh) if a in leaf else '-'),x[7],x[4]/1e6,x[5]/1e6,x[6],100*x[6]/Ld))
