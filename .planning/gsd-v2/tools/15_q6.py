import sys,re; sys.path.insert(0,'.')
from lib import *
R=load(); RP={r['path']:r for r in R}
S2=[json.loads(l) for l in open('out/scan2.jsonl')]
# recurring activities by normalized description
def nd(d):
    d=(d or 'None').lower()
    d=re.sub(r'\b\d{3}(\.\d)?(-\d{2}[a-z]?)?\b','N',d)
    d=re.sub(r'\b(r|round|pass|batch|group|part|run|restart|#)\s*\d+\b',r'\1 K',d)
    d=re.sub(r'\b[a-z]\d+[a-z]?\b','X',d)
    d=re.sub(r'\d+','K',d)
    return d[:60]
F=collections.defaultdict(lambda:[0,0.0,0.0])
for r in R:
    if r['kind']=='top': continue
    k=nd(r['meta'].get('description'))
    x=F[k]; x[0]+=1; x[1]+=wall(r)/3600; x[2]+=tokens(r)[4]
print('TOP normalized descriptions by est $')
for k,v in sorted(F.items(),key=lambda x:-x[1][2])[:16]: print('  %-60s n=%d  %.1f h  $%.0f'%(k,v[0],v[1],v[2]))
print('TOP by agent-hours')
for k,v in sorted(F.items(),key=lambda x:-x[1][1])[:12]: print('  %-60s n=%d  %.1f h  $%.0f'%(k,v[0],v[1],v[2]))
# resumes / redispatch
rx=re.compile(r'resume|death|re-dispatch|redispatch|continue|retry|handoff|hand-off|restart|relaunch|take over|takeover|from checkpoint',re.I)
res=[r for r in R if r['kind']=='sub' and rx.search(r['meta'].get('description') or '')]
print('resume/retry/continue-style spawns',len(res),'of',sum(1 for r in R if r['kind']=='sub'),'agent-h %.0f est$ %.0f'%(sum(wall(r) for r in res)/3600,sum(tokens(r)[4] for r in res)))
cr=[r for r in res if role(r)=='gsd-phase-coordinator']
print(' coordinators w/ resume-style desc',len(cr),'of',sum(1 for r in R if role(r)=='gsd-phase-coordinator'),'h %.0f $%.0f'%(sum(wall(r) for r in cr)/3600,sum(tokens(r)[4] for r in cr)))
print(collections.Counter(role(r) for r in res).most_common(6))
# coordinators by phase count
ph=collections.Counter()
for r in R:
    if role(r)=='gsd-phase-coordinator':
        m=re.search(r'\b(3[6-9]\d|40\d)(\.\d)?\b',(r['meta'].get('description') or ''))
        ph[m.group(0) if m else '?']+=1
print('coordinator spawns per phase: n phases',len(ph),'mean %.2f'%statistics.mean(ph.values()),'top',ph.most_common(8))
# repeated tests
reps=collections.Counter()
for s in S2:
    for k,v in s['reps'].items(): reps[k]+=v
rr=sum(v-1 for v in reps.values() if v>1)  # in-transcript repeats beyond first
print('commands repeated >1x within a single transcript: extra runs',rr,'distinct cmds',len(reps))
for k,v in reps.most_common(8): print('   ',v,k[:150])
# stack ops shapes
sh=collections.defaultdict(lambda:[0,0.0])
for s in S2:
    for k,v in s['shapes'].items():
        if re.match(r'(supabase|npx supabase|orbctl|docker|colima)',k): sh[k][0]+=v[0]; sh[k][1]+=v[1]
for k,v in sorted(sh.items(),key=lambda x:-x[1][1])[:12]: print('  stack-shape',k,v[0],'%.1f h'%(v[1]/3600))
# restart agents
rs=[r for r in R if re.search(r'orbstack|restart|stack start|supabase start|host cleanup|db reset',(r['meta'].get('description') or ''),re.I)]
print('stack/host agents',len(rs),'h %.0f $%.0f'%(sum(wall(r) for r in rs)/3600,sum(tokens(r)[4] for r in rs)))
cl=[r for r in R if re.search(r'periodic|host cleanup|disk/ram|delivery report|tick',(r['meta'].get('description') or ''),re.I)]
print(' periodic ticks',len(cl),'h %.1f $%.0f'%(sum(wall(r) for r in cl)/3600,sum(tokens(r)[4] for r in cl)))
ob=[r for r in R if re.search(r'orbstack',(r['meta'].get('description') or ''),re.I)]
print(' orbstack-named agents',len(ob),'h %.1f $%.0f'%(sum(wall(r) for r in ob)/3600,sum(tokens(r)[4] for r in ob)), collections.Counter(day(r['t0']) for r in ob))
# coordinators wait structure
c=[r for r in R if role(r)=='gsd-phase-coordinator']
cat=collections.defaultdict(lambda:[0,0.0])
for r in c:
    for k,v in r['cat'].items(): cat[k][0]+=v[0]; cat[k][1]+=v[1]
tw=sum(r['wall'] if False else wall(r) for r in c)/3600
print('coordinator wall h',round(tw))
for k,v in sorted(cat.items(),key=lambda x:-x[1][1])[:8]: print('  ',k,v[0],'%.0f h'%(v[1]/3600))
