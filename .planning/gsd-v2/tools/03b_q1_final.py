import sys; sys.path.insert(0,'.')
from lib import *
R=load()
G=collections.defaultdict(list)
for r in R: G[(role(r),rtier(r))].append(r)
rows=[]
for (ro,mo),L in G.items():
    aw=[r['active']/60 for r in L]; tk=[sum(tokens(r)[:4]) for r in L]; S=[sum(tokens(r)[i] for r in L) for i in range(5)]
    rows.append((ro,mo,len(L),sum(wall(r) for r in L)/3600,sum(aw)/60,statistics.median(aw),pct(aw,90),S,statistics.median(tk),pct(tk,90),statistics.median([r['n_msgs'] for r in L])))
rows.sort(key=lambda x:-x[7][4])
print('| role | model | spawns | wall h | active h | active min med | active min p90 | fresh in M | cache write M | cache read M | output M | est $ | $/spawn | tokens/spawn med (M) | p90 (M) | API turns med |')
print('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
for x in rows:
    S=x[7]
    if x[2]<3 and S[4]<5: continue
    print('| %s | %s | %d | %.0f | %.0f | %.1f | %.0f | %.1f | %.0f | %.0f | %.1f | %.0f | %.2f | %.2f | %.1f | %d |'%(x[0],x[1],x[2],x[3],x[4],x[5],x[6],S[0]/1e6,S[1]/1e6,S[2]/1e6,S[3]/1e6,S[4],S[4]/x[2],x[8]/1e6,x[9]/1e6,x[10]))
print('small roles:',[(x[0],x[1],x[2],round(x[7][4])) for x in rows if x[2]<3 and x[7][4]<5])
