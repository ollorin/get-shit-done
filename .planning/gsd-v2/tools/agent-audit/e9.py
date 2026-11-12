from common import *
S=rs('gsd-executor')
sm=[r for r in S if any(e[0]=='tu' and e[1]=='Write' and (e[2].get('p') or '').endswith('-SUMMARY.md') for e in P[r['path']])]
def spawns(r): return [e[2] for e in P[r['path']] if e[0]=='tu' and e[1] in('Agent','Task')]
print('executors writing SUMMARY',len(sm))
print(' of which spawned docs-updater',sum(any(i['st']=='gsd-docs-updater' for i in spawns(r)) for r in sm))
print(' of which docs-ish gp spawn',sum(any(i['st'] in(None,'general-purpose') and re.search(r'(?i)doc',i['desc'] or '') for i in spawns(r)) for r in sm))
print(' spawned test-writer',sum(any(i['st']=='gsd-test-writer' for i in spawns(r)) for r in sm))
print(' wrote Self-Check text',sum('Self-Check' in str([e[2] for e in P[r['path']] if e[0]=='tu' and e[1]=='Write' and (e[2].get('p') or '').endswith('SUMMARY.md')]) for r in sm))
# SUMMARY without a test run in whole transcript
testrx=re.compile(r'deno (task )?test|nx test|run-integration|test:ci|vitest|flutter test')
print(' SUMMARY writers with NO test cmd at all in transcript',sum(not any(e[0]=='tu' and e[1]=='Bash' and testrx.search(e[2]['cmd']) for e in P[r['path']]) for r in sm))
# SUMMARY write before last test cmd?
bad=0;ex=[]
for r in sm:
    ev=P[r['path']]
    wi=[i for i,e in enumerate(ev) if e[0]=='tu' and e[1]=='Write' and (e[2].get('p') or '').endswith('-SUMMARY.md')]
    ti=[i for i,e in enumerate(ev) if e[0]=='tu' and e[1]=='Bash' and testrx.search(e[2]['cmd'])]
    if ti and wi and wi[0]<ti[0]: bad+=1; ex.append(bn(r))
print(' SUMMARY written BEFORE first test cmd',bad,ex[:3])
# executors spawning gp for review: 'reviews' of own work
rv=[r for r in S if any(re.search(r'(?i)review',i['desc'] or '') and i['st'] in(None,'general-purpose') for i in spawns(r))]
print('executors spawning gp reviewer',len(rv),[bn(r) for r in rv[:3]])
