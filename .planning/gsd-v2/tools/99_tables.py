import sys,re; sys.path.insert(0,'.')
from lib import *
R=load()
out=[]
def P(*a): print(*a)
# tier totals
T=collections.defaultdict(lambda:[0,0.0,0,0,0,0,0.0])
for r in R:
    t=rtier(r); x=T[t]; k=tokens(r); x[0]+=1; x[1]+=wall(r)/3600
    for i in range(4): x[2+i]+=k[i]
    x[6]+=k[4]
P('TIER totals'); 
tu=sum(v[6] for v in T.values())
for t,x in T.items(): P(t,x[0],'agent-h %.0f'%x[1],'fresh %.0fM cw %.0fM cr %.0fM out %.1fM'%tuple(y/1e6 for y in x[2:6]),'$%.0f (%.0f%%)'%(x[6],100*x[6]/tu))
tot=[sum(tokens(r)[i] for r in R) for i in range(4)]
P('token mix: fresh %.1f%% cw %.1f%% cr %.1f%% out %.2f%%'%tuple(100*t/sum(tot) for t in tot))
units=[tot[0]*1,tot[1]*1.25,tot[2]*0.1,tot[3]*5]; P('cost-unit mix: fresh %.1f%% cw %.1f%% cr %.1f%% out %.1f%%'%tuple(100*u/sum(units) for u in units))
# spawn counts by agent type (all, incl. main-session)
c=collections.Counter(role(r) for r in R if r['kind']=='sub')
P(c.most_common())
# first/last dates by role of special agents
for ro in('gsd-plan-attacker','gsd-plan-defender','gsd-plan-judge','gsd-integration-checker','gsd-roadmapper','gsd-e2e-test-generator','gsd-codebase-mapper','gsd-phase-researcher','gsd-docs-updater','gsd-charlotte-qa','fork'):
    L=[r for r in R if role(r)==ro]
    if L: P(ro,len(L),day(min(r['t0'] for r in L)),day(max(r['t0'] for r in L)),'h %.1f $%.0f'%(sum(wall(r) for r in L)/3600,sum(tokens(r)[4] for r in L)))
# top-10 spawns by $
L=sorted([r for r in R if r['kind']=='sub'],key=lambda r:-tokens(r)[4])[:10]
P('TOP spawns by $')
for r in L: P(' $%.0f %.1fh %s %s | %s | msgs %d'%(tokens(r)[4],wall(r)/3600,role(r),rtier(r),r['meta'].get('description'),r['n_msgs']))
L=sorted([r for r in R if r['kind']=='sub' and role(r)!='gsd-phase-coordinator'],key=lambda r:-wall(r))[:6]
P('TOP leaf spawns by wall')
for r in L: P(' %.1fh idle>30m %.1fh $%.0f %s %s | %s'%(wall(r)/3600,r['idle_total']/3600,tokens(r)[4],role(r),rtier(r),r['meta'].get('description')))
# executors: ctx / compaction
E=[r for r in R if role(r)=='gsd-executor']
P('executors',len(E),'with compaction',sum(1 for r in E if r['api_errors'].get('compact_boundary')),'max ctx med %d p90 %d'%(statistics.median([r['max_ctx'] for r in E]),pct([r['max_ctx'] for r in E],90)))
# msgs per executor
P('executor msgs med %d p90 %d'%(statistics.median([r['n_msgs'] for r in E]),pct([r['n_msgs'] for r in E],90)))
# opus vs sonnet executors share
P('executor tiers',collections.Counter(rtier(r) for r in E))
# phases
ph=collections.Counter()
for r in R:
    if role(r)=='gsd-phase-coordinator':
        m=re.search(r'\b(3[6-9]\d|40\d)(\.\d)?\b',(r['meta'].get('description') or '')+(r.get('first_prompt') or '')[:200])
        ph[m.group(0) if m else '?']+=1
P('coordinator phases',len(ph),sorted(ph.items()))
