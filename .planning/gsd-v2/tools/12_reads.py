import sys,os,re; sys.path.insert(0,'.')
from lib import *
R=[r for r in load() if r['kind']=='sub' and not r['proj'].endswith('charlotte')]
def normp(p):
    p=p.replace('<project-root>/','').replace('<home>/','~/')
    p=re.sub(r'\.tmp/wt-[\w.-]+/','.tmp/wt-N/',p)
    p=re.sub(r'phases/[\w.-]+/','phases/<P>/',p)
    p=re.sub(r'\d{3}(\.\d+)?-\d{2}','NNN-NN',p)
    p=re.sub(r'\d{3}(\.\d+)?','NNN',p)
    p=re.sub(r'\d{14}','TS',p)
    return p[:95]
for ro,tr in(('gsd-executor','sonnet'),('gsd-executor','haiku'),('gsd-planner','opus'),('gsd-plan-checker','opus'),('gsd-verifier','opus'),('gsd-phase-coordinator','sonnet')):
    L=[r for r in R if role(r)==ro and rtier(r)==tr]
    c=collections.defaultdict(lambda:[0,0])
    tot=[]
    for r in L:
        seen=set(); t=0
        for p,n,tn in r['first_reads']:
            t+=n
            k=normp(p)
            if k in seen: continue
            seen.add(k); c[k][0]+=1; c[k][1]+=n
        tot.append(t)
    print('==',ro,tr,len(L),'median chars read in first 40 turns',int(statistics.median(tot)),'p90',int(pct(tot,90)))
    for k,v in sorted(c.items(),key=lambda x:-x[1][1])[:8]: print('   %3d%% %-90s avg %d chars'%(100*v[0]/len(L),k,v[1]/v[0]))
