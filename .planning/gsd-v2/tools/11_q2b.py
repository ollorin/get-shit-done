import sys,os; sys.path.insert(0,'.')
from lib import *
R=[r for r in load() if r['kind']=='sub' and not r['proj'].endswith('charlotte')]
# instruction file sizes (median across spawns)
P=collections.defaultdict(list)
for r in R:
    for p,n in r['instr']: P[p].append(n)
print('INSTR files (chars, n spawns)')
for p,v in sorted(P.items(),key=lambda x:-statistics.median(x[1])*len(x[1]))[:10]: print(' ',p.replace('<home>/',''),int(statistics.median(v)),len(v))
# nested memory
N=collections.defaultdict(lambda:[0,0])
for r in R:
    seen=set()
    for p,n,k in r['nested']:
        if p in seen: continue
        seen.add(p); N[p][0]+=1; N[p][1]=n
print('NESTED rules (spawns loading, chars)')
for p,v in sorted(N.items(),key=lambda x:-x[1][0])[:14]: print(' ',p.replace('<home>/',''),v)
# GSD reads by role: files read
CR=collections.defaultdict(lambda:[0,0,set()])
RR=collections.defaultdict(lambda:[0,0,0])  # role: spawns, total gsd chars, n reads
roleN=collections.Counter()
for r in R:
    ro=role(r); roleN[ro]+=1
    for p,(n,c) in r['claude_reads'].items():
        if '/.claude/get-shit-done/' in p or '/.claude/agents/' in p or '/.claude/commands/' in p:
            x=CR[(ro,p.replace('<home>/.claude/',''))]; x[0]+=n; x[1]+=c; x[2].add(r['path'])
            y=RR[ro]; y[1]+=c; y[2]+=n
print('--- GSD file reads by role (spawns reading / total spawns, mean chars per read)')
byrole=collections.defaultdict(list)
for (ro,p),x in CR.items(): byrole[ro].append((len(x[2]),p,x[1]/max(1,x[0])))
for ro in sorted(byrole,key=lambda k:-roleN[k]):
    if roleN[ro]<10: continue
    tot=sum(RR[ro][1] for _ in[0])
    print(ro,'spawns',roleN[ro],'total GSD chars read/spawn',int(RR[ro][1]/roleN[ro]),'reads/spawn %.1f'%(RR[ro][2]/roleN[ro]))
    for n,p,m in sorted(byrole[ro],reverse=True)[:6]: print('    %4d spawns (%d%%) %-70s %d chars'%(n,100*n/roleN[ro],p,m))
# on-disk sizes
base=os.path.expanduser('~/.claude/')
def sz(p):
    try: return os.path.getsize(os.path.join(base,p))
    except: return None
print('--- on-disk sizes')
for p in ['agents/gsd-executor.md','agents/gsd-planner.md','agents/gsd-plan-checker.md','agents/gsd-verifier.md','agents/gsd-phase-coordinator.md','agents/gsd-debugger.md','agents/gsd-test-writer.md','agents/gsd-charlotte-qa.md','agents/gsd-docs-updater.md','agents/gsd-phase-researcher.md']:
    print(p,sz(p))
