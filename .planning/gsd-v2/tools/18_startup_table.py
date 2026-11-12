import sys,json,collections,random; sys.path.insert(0,'.')
from lib import *
R=load(); random.seed(11)
cols=['system','tools','instructions','skill_listing','session_context','user_prompt','other']
print('| role/model | n sampled | first-turn ctx tokens (med) | agent def/system chars | tools-schema chars | CLAUDE.md+MEMORY+rules chars | skill listing chars | session ctx (gitStatus etc) chars | spawn prompt chars | tokens: agent-def | tools | instructions | skill listing | other |')
for ro,tr in(('gsd-executor','sonnet'),('gsd-executor','haiku'),('gsd-phase-coordinator','sonnet'),('gsd-planner','opus'),('gsd-plan-checker','opus'),('gsd-verifier','opus'),('gsd-debugger','sonnet'),('gsd-docs-updater','haiku'),('gsd-charlotte-qa','sonnet'),('gsd-test-writer','haiku'),('gsd-plan-attacker','opus'),('general-purpose','haiku'),('general-purpose','sonnet'),('general-purpose','opus')):
    L=[r for r in R if role(r)==ro and rtier(r)==tr and r['first_turn'] and sum(r['first_turn'][1:4])>10000 and r['shape']]
    L=random.sample(L,min(10,len(L)))
    comp=collections.defaultdict(list); fts=[]
    for r in L:
        parts=collections.Counter()
        for line in open(r['path'],errors='replace'):
            if line.startswith('{"type":'): continue
            try: d=json.loads(line)
            except: continue
            if d['type']=='assistant': break
            if d['type']=='attachment':
                for x in d.get('rendered') or []: parts[d['attachment']['type']]+=len(x.get('content',''))
            elif d['type']=='user':
                c=d['message']['content']; parts['user_prompt']+=len(c) if isinstance(c,str) else sum(len(b.get('text','')) for b in c)
        parts['system']=r['shape']['system_chars']; parts['tools']=r['shape']['tools_chars']
        tot=sum(parts.values()); ft=sum(r['first_turn'][1:4]); fts.append(ft)
        k=ft/tot
        g={'system':parts['system'],'tools':parts['tools']+parts['deferred_tools_delta'],'instructions':parts['instructions'],'skill_listing':parts['skill_listing'],'session_context':parts['session_context'],'user_prompt':parts['user_prompt']}
        g['other']=tot-sum(g.values())
        for c in cols: comp[c].append(g[c])
        comp['_k'].append(k)
    if not L: continue
    m=lambda c: statistics.median(comp[c])
    k=statistics.median(comp['_k'])
    print('| %s %s | %d | %d | %d | %d | %d | %d | %d | %d | %d | %d | %d | %d | %d |'%(ro,tr,len(L),statistics.median(fts),m('system'),m('tools'),m('instructions'),m('skill_listing'),m('session_context'),m('user_prompt'),m('system')*k,m('tools')*k,m('instructions')*k,m('skill_listing')*k,(m('other')+m('session_context')+m('user_prompt'))*k))
