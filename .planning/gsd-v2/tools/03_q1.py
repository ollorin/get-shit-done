import sys; sys.path.insert(0,'.')
from lib import *
R=load()
G=collections.defaultdict(list)
for r in R: G[(role(r),rtier(r))].append(r)
rows=[]
for (ro,mo),L in G.items():
    w=[wall(r)/60 for r in L]
    tk=[sum(tokens(r)[:4]) for r in L]
    S=[sum(tokens(r)[i] for r in L) for i in range(5)]
    rows.append((ro,mo,len(L),sum(w)/60,statistics.median(w),pct(w,90),S[0],S[1],S[2],S[3],S[4],statistics.median(tk),pct(tk,90),statistics.median([r['n_msgs'] for r in L])))
rows.sort(key=lambda x:-x[10])
print('| role | model | spawns | agent-hours | wall med min | wall p90 min | fresh-in M | cache-write M | cache-read M | out M | est $ | tok med (M, all kinds) | tok p90 (M) | msgs med |')
for x in rows:
    print('| %s | %s | %d | %.1f | %.1f | %.1f | %.2f | %.1f | %.0f | %.2f | %.0f | %.2f | %.2f | %d |'%(x[0],x[1],x[2],x[3],x[4],x[5],x[6]/1e6,x[7]/1e6,x[8]/1e6,x[9]/1e6,x[10],x[11]/1e6,x[12]/1e6,x[13]))
tot=[sum(tokens(r)[i] for r in R) for i in range(5)]
print('TOTAL',[round(t/1e6,1) for t in tot[:4]],round(tot[4]))
