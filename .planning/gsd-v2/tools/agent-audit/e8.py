from common import *
S=rs('gsd-executor')
sp=[]
for r in S:
    for e in P[r['path']]:
        if e[0]=='tu' and e[1] in('Agent','Task'): sp.append((r,e[2]))
print('spawns',len(sp),'by executors',len({r['path'] for r,_ in sp}),'of',len(S))
print('subagent_type',collections.Counter(i['st'] for _,i in sp).most_common())
print('model',collections.Counter((i['st'],i['model']) for _,i in sp).most_common(14))
print('bg',collections.Counter(i['bg'] for _,i in sp))
def dc(d):
    d=(d or '').lower()
    for k,rx in [('review/verify',r'review|verify|audit|pre-?verif|check'),('docs updater/summary',r'doc|summary|changelog'),('test run',r'test|suite|bucket|run |preflight|integration'),('mutation',r'mutat|proof'),('fix/impl',r'fix|implement|apply|execute|write|add|migrat|refactor|extract'),('research/lookup',r'research|find|search|look|trace|investigat|read|explore'),('commit/git',r'commit|git')]:
        if re.search(rx,d): return k
    return 'other'
gp=[(r,i) for r,i in sp if i['st'] in(None,'general-purpose')]
print('gp',len(gp),collections.Counter(dc(i['desc']) for _,i in gp).most_common(), 'model omitted',sum(1 for _,i in gp if not i['model']))
print('gp model',collections.Counter(i['model'] for _,i in gp))
import random; random.seed(2)
for r,i in random.sample(gp,14): print('  ',bn(r)[:20],i['model'],i['desc'],'|',i['prompt'][:110].replace('\n',' '))
nest=[(r,i) for r,i in sp if i['st']=='gsd-executor']
print('nested gsd-executor',len(nest),collections.Counter(i['model'] for _,i in nest), 'parents',len({r['path'] for r,_ in nest}))
for r,i in nest[:12]: print('  ',bn(r)[:20],r['meta'].get('description'),'->',i['model'],i['desc'],'|',i['prompt'][:130].replace('\n',' '))
print('other types',collections.Counter(i['st'] for _,i in sp if i['st'] not in(None,'general-purpose','gsd-executor')))
# which executors spawned most
cnt=collections.Counter(r['path'] for r,_ in sp); print([ (os.path.basename(p),v) for p,v in cnt.most_common(4)])
# by-parent spawn: model of executor vs child model
