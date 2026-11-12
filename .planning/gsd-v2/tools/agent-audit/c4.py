from common import *
S=rs('gsd-phase-coordinator'); N=len(S)
c=collections.Counter(); ex=collections.defaultdict(list)
def mk(k,r):
    c[k]+=1
    if len(ex[k])<3: ex[k].append(bn(r))
for r in S:
    ev=P[r['path']]; tus=[e for e in ev if e[0]=='tu']; alltxt='\n'.join(e[1] for e in ev if e[0]=='text'); lt=last_text(ev)
    s=lambda e: (e[2].get('p') or '')+(e[2].get('cmd') or '')
    if re.search(r'"steps_completed"|"status"\s*:\s*"(completed|failed|blocked|gaps_found|human_needed)"',lt): mk('final text has return_state JSON',r)
    if any(e[1]=='Write' and 'CHECKPOINT.json' in s(e) for e in tus) or any(e[1]=='Bash' and 'CHECKPOINT.json' in s(e) and '>' in s(e) for e in tus): mk('writes CHECKPOINT.json',r)
    for ref in ['coordinator-detail','execute-phase.md','handoff-brief','content-firewall','agent-messaging','resilience']:
        if any(ref in s(e) for e in tus if e[1] in('Read','Bash')): mk('reads '+ref,r)
    if any(e[1]=='Write' and 'VERIFICATION.md' in s(e) for e in tus): mk('writes VERIFICATION.md itself',r)
    if any(e[1] in('Agent','Task') and e[2]['st']=='gsd-verifier' for e in tus): mk('spawns gsd-verifier',r)
    if any(e[1] in('Agent','Task') and e[2]['st']=='gsd-executor' for e in tus): mk('spawns gsd-executor',r)
    if any(e[1] in('Agent','Task') and e[2]['st']=='gsd-planner' for e in tus): mk('spawns gsd-planner',r)
    if any(e[1] in('Agent','Task') and e[2]['st']=='gsd-plan-checker' for e in tus): mk('spawns plan-checker',r)
    if any(e[1] in('Agent','Task') and e[2]['st']=='gsd-phase-researcher' for e in tus): mk('spawns researcher',r)
    if any(e[1] in('Agent','Task') and e[2]['st']=='gsd-charlotte-qa' for e in tus): mk('spawns charlotte-qa',r)
    ex_sp=[e for e in tus if e[1] in('Agent','Task') and e[2]['st']=='gsd-executor']
    if ex_sp:
        hb=sum(1 for e in ex_sp if re.search(r'(?i)handoff[ _]brief',e[2]['prompt']))
        c['executor spawns']+=len(ex_sp); c['executor spawns w/ handoff brief (first 500ch)']+=hb
        c['executor spawns w/ model omitted']+=sum(1 for e in ex_sp if not e[2]['model'])
        c['executor spawns background']+=sum(1 for e in ex_sp if str(e[2]['bg']).lower()=='true')
    if re.search(r'(?i)self-check: passed|Self-Check',alltxt): mk('mentions Self-Check',r)
    if re.search(r'git log|SUMMARY\.md',' '.join(s(e) for e in tus if e[1]=='Bash')): mk('bash checks SUMMARY/git log',r)
    if re.search(r'phase complete|verify phase-gate|phase-gate',' '.join(s(e) for e in tus if e[1]=='Bash')): mk('runs gsd-tools phase complete/phase-gate',r)
    if re.search(r'context_budget|context_pressure',alltxt): mk('mentions context_budget/pressure',r)
    if re.search(r'df -h',' '.join(s(e) for e in tus if e[1]=='Bash')): mk('df -h check',r)
    if r.get('ended_err'): mk('ended_err',r)
    if any(e[1]=='SendMessage' for e in tus): mk('SendMessage',r)
    if any(e[1]=='SubagentHandback' for e in tus): mk('SubagentHandback',r)
print(N)
for k,v in sorted(c.items()): print(f'{k:55s}{v:5d}', f'{100*v/N:5.1f}%' if v<=N else '', ex.get(k,[])[:2])
sm=collections.Counter(); 
for r in S:
    for e in P[r['path']]:
        if e[0]=='tu' and e[1]=='SendMessage': sm[(e[2]['to'][:14])]+=1
print(sm.most_common(8))
