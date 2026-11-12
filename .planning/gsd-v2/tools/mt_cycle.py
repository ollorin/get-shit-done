import sys,os,statistics,collections
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from mt_analyze import *
leaf=[x for x in X if x['role']!='gsd-phase-coordinator']
def q(v,p): v=sorted(v); return v[int(p*(len(v)-1))] if v else 0
for cls in ('db-reset','test-unit-file','test-live-file','test-bucket'):
    D=[];G=[]
    for x in leaf:
        iv=attrib(x,'mid')[0]
        cs=[c for c in x['calls'] if c[2]==cls and ov(c[0],c[0]+max(c[1],1),iv)>0]
        D+= [c[1] for c in cs if 0<c[1]<3600]
        for a,b in zip(cs,cs[1:]):
            g=b[0]-a[0]
            if 0<g<1200: G.append(g)
    print('%-15s n=%5d dur p50 %.0fs p90 %.0fs | consecutive-start gap n=%d p50 %.0fs p90 %.0fs'%(cls,len(D),q(D,.5),q(D,.9),len(G),q(G,.5),q(G,.9)))
# per spawn: resets / mutants
rows=[]
import re
for x in leaf:
    d=x['desc'] or ''
    m=re.findall(r'\bM(\d+)(?:\s*[-–]\s*M?(\d+))?',d)
    n=0
    for a,b in m: n+= (int(b)-int(a)+1) if b and int(b)>=int(a) else 1
    iv=attrib(x,'mid')[0]
    if not iv or n==0: continue
    L=sum(b-a for a,b in iv)/60
    rs=sum(1 for c in x['calls'] if c[2]=='db-reset' and ov(c[0],c[0]+1,iv)>0)
    rows.append((n,L,rs,x['model'],d[:70]))
print('spawns with mutant counts in desc:',len(rows))
per=[L/n for n,L,rs,mo,d in rows]
print('min per mutant (mutation-interval minutes / mutants in desc): p25 %.1f p50 %.1f p75 %.1f p90 %.1f'%(q(per,.25),q(per,.5),q(per,.75),q(per,.9)))
sql=[L/n for n,L,rs,mo,d in rows if rs>=n/2]
uni=[L/n for n,L,rs,mo,d in rows if rs==0]
print('  with ~1 db-reset/mutant (SQL/live): n=%d p50 %.1f ; zero resets (unit): n=%d p50 %.1f'%(len(sql),q(sql,.5),len(uni),q(uni,.5)))
for r in sorted(rows,key=lambda r:-r[1])[:6]: print('  ',r)
