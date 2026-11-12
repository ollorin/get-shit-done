from common import *
import json, statistics as st
S=rs('gsd-planner'); N=len(S)
plans={}  # path -> (r, content) last write per transcript
stats=collections.defaultdict(list)
tagc=collections.Counter()
nonmd=[]
for r in S:
    for l in open(r['path']):
        if '"Write"' not in l: continue
        try: d=json.loads(l)
        except: continue
        m=d.get('message')
        if not isinstance(m,dict) or not isinstance(m.get('content'),list): continue
        for b in m['content']:
            if b.get('type')=='tool_use' and b['name']=='Write':
                p=b['input'].get('file_path',''); c=b['input'].get('content','')
                if p.endswith('-PLAN.md'):
                    plans[(r['path'],p)]=c
                elif not p.endswith('.md') and '/.tmp/' not in p: nonmd.append((bn(r),p))
print('transcripts',N,'distinct PLAN.md writes',len(plans),'transcripts writing >=1 plan',len({k[0] for k in plans}))
sizes=[len(c) for c in plans.values()]
print('plan bytes med',st.median(sizes),'p90',sorted(sizes)[int(.9*len(sizes))],'max',max(sizes))
tk=[len(re.findall(r'<task\b',c)) for c in plans.values()]
print('tasks/plan med',st.median(tk),'mean',round(st.mean(tk),1),'>3 tasks share',round(sum(1 for t in tk if t>3)/len(tk),2),'>=6',round(sum(1 for t in tk if t>=6)/len(tk),2))
def share(rx): return round(100*sum(1 for c in plans.values() if re.search(rx,c))/len(plans))
for name,rx in [('<model> or model: tier tag',r'(?i)<model>|\bmodel:\s*(haiku|sonnet|opus)|\btier\b[^\n]{0,20}(haiku|sonnet|opus)|(haiku|sonnet|opus)\s+(task|implement)'),('<model> xml tag',r'<model>'),('Haiku mentioned',r'(?i)haiku'),('tdd="true"',r'tdd="true"'),('T0 tier tags',r'\bT0\b'),('mutation',r'(?i)mutant|mutation'),('threat model',r'(?i)threat'),('must_haves',r'must_haves'),('e2e_flows',r'e2e_flows'),('checkpoint:ui-qa',r'checkpoint:ui-qa'),('REUSE citation',r'REUSE'),('deferral language',r'(?i)deferred to|to be added later|follow-up:|test later|next phase'),('wave: frontmatter',r'(?m)^wave:'),('autonomous:',r'autonomous:')]:
    print(f'  plans containing {name}: {share(rx)}%')
print('non-md files written outside .tmp',len(nonmd),nonmd[:4])
# per transcript
c=collections.Counter(); ex=collections.defaultdict(list)
def mk(k,r):
    c[k]+=1
    if len(ex[k])<2: ex[k].append(bn(r))
for r in S:
    ev=P[r['path']]; tus=[e for e in ev if e[0]=='tu']; alltxt='\n'.join(e[1] for e in ev if e[0]=='text'); lt=last_text(ev)
    s=lambda e: (e[2].get('p') or '')+(e[2].get('cmd') or '')
    if 'PLANNING COMPLETE' in alltxt: mk('PLANNING COMPLETE text',r)
    if 'PLAN REJECTED' in alltxt: mk('PLAN REJECTED',r)
    if 'GAP CLOSURE PLANS CREATED' in alltxt: mk('GAP CLOSURE text',r)
    if re.search(r'"status"\s*:\s*"(planning_complete|gap_closure_complete|plan_rejected|checkpoint|revision_complete)"',alltxt): mk('JSON status trailer',r)
    if re.search(r'## REVISION COMPLETE|revision',lt[:200],re.I): mk('revision-ish final',r)
    sp=[e for e in tus if e[1] in('Agent','Task')]
    if sp: mk('spawns any agent',r)
    for e in sp: c['spawn:'+str(e[2]['st'])+':'+str(e[2]['model'])]+=1
    if any(e[1] in('Agent','Task') and e[2]['st']=='gsd-plan-checker' for e in tus): mk('spawns plan-checker',r)
    for ref,k in [('RESEARCH','reads *RESEARCH*'),('CONTEXT','reads *CONTEXT*'),('planner-detail','reads planner-detail'),('content-firewall','reads content-firewall'),('STATE.md','reads STATE.md'),('ROADMAP','reads ROADMAP'),('checkpoints.md','reads checkpoints.md'),('tdd.md','reads tdd.md'),('handoff-brief','reads handoff-brief'),('DECISION','reads DECISION*'),('RULING','reads *RULING*'),('gsd-tools','uses gsd-tools')]:
        if any(ref in s(e) for e in tus if e[1] in('Read','Bash')): mk(k,r)
    if any('git commit' in s(e) for e in tus if e[1]=='Bash'): mk('git commit',r)
    if any(e[1]=='Write' and 'CHECKPOINT' in s(e) for e in tus): mk('writes CHECKPOINT',r)
    if r.get('ended_err'): mk('ended_err',r)
    if any(e[1]=='SubagentHandback' for e in tus): mk('SubagentHandback',r)
    if any(e[1]=='Write' and e[2].get('p','').endswith('-PLAN.md') for e in tus): mk('writes PLAN.md',r)
    if any(e[1]=='Write' and e[2].get('p','').endswith('-RESEARCH.md') for e in tus): mk('writes RESEARCH.md',r)
print(N)
for k,v in sorted(c.items()): print(f'  {k:50s}{v:5d} {100*v/N:5.1f}%', ex.get(k,[])[:2])
