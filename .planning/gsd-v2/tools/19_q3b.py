import sys; sys.path.insert(0,'.')
from lib import *
R=load()
def grp(c):
    if c.startswith('bash:wait'): return 'wait/poll loops (shell sleep/until)'
    if c in('bash:test',): return 'run unit tests (deno task test etc.)'
    if c=='bash:integration-test': return 'run integration buckets'
    if c in('bash:stack-lock-run',): return 'stack-lock wrapper (non-test)'
    if c=='bash:mutation': return 'mutation/mutant commands'
    if c in('bash:preflight','bash:gates-lint-check','bash:coverage'): return 'preflight/gates/lint/typecheck/coverage'
    if c=='bash:stack-ops': return 'stack ops (supabase/orbctl/docker)'
    if c in('bash:charlotte','mcp:charlotte'): return 'Charlotte QA'
    if c=='edit:impl': return 'edit/write implementation code'
    if c=='edit:test': return 'edit/write tests'
    if c=='edit:planning-docs': return 'edit/write .planning/.tmp/md (evidence, summaries, registers)'
    if c.startswith('edit:'): return 'edit/write docs/other'
    if c.startswith('read:'): return 'read files'
    if c in('bash:search',): return 'search (zg/rg)'
    if c=='bash:git': return 'git'
    if c in('bash:file-inspect-script','bash:other','bash:host-disk-proc','bash:gsd-tools'): return 'other bash (file inspect, scripts, host/disk, gsd-tools)'
    if c.startswith('spawn:'): return 'spawn subagent (foreground wait)'
    if c.startswith('wait:') or c=='tool:AskUserQuestion' or c=='tool:ListAgents': return 'wait/monitor/ask-user tools'
    if c=='noTool': return 'model-only turns (no tool call)'
    return 'other tools'
def table(rows,title):
    G=collections.defaultdict(lambda:[0,0.0,0.0,0,0.0])
    W=0.0; U=0.0
    for r in rows:
        W+=r['active']/3600; 
        for c,v in r['cat'].items():
            g=grp(c); x=G[g]
            x[0]+=v[0]; x[1]+=v[1]/3600
            p=PRICE.get(rtier(r),0.43) if rtier(r) in PRICE else 0.43
            usd=p*(v[2]+1.25*v[3]+0.1*v[4]+5*v[5])/1e6
            x[2]+=usd; x[3]+=v[5]; U+=usd
    print('###',title,'n=',len(rows),'active wall h %.0f, est $ %.0f'%(W,U))
    print('| category | calls | tool-wait h | % of active wall | est $ (tokens of turns that issued it) | % $ | out tokens M |')
    for g,x in sorted(G.items(),key=lambda kv:-kv[1][2]):
        print('| %s | %d | %.1f | %.1f%% | %.0f | %.1f%% | %.2f |'%(g,x[0],x[1],100*x[1]/W,x[2],100*x[2]/U,x[3]/1e6))
leaf=[r for r in R if role(r) not in('gsd-phase-coordinator','MAIN-session') and r['kind']=='sub']
table(leaf,'ALL leaf agents (excl. coordinators, main)')
table([r for r in leaf if role(r)=='gsd-executor'],'gsd-executor only')
table([r for r in R if role(r)=='gsd-phase-coordinator'],'coordinators')
table([r for r in R if role(r)=='MAIN-session'],'MAIN sessions')
