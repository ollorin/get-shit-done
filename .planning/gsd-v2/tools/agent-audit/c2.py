from common import *
S=rs('gsd-phase-coordinator')
sp=[(r,e[2]) for r in S for e in P[r['path']] if e[0]=='tu' and e[1] in('Agent','Task')]
print('spawns',len(sp))
print(collections.Counter(i['st'] for _,i in sp).most_common())
print('model by type',collections.Counter((i['st'],i['model']) for _,i in sp).most_common(20))
print('no model param',sum(1 for _,i in sp if not i['model']), collections.Counter(i['st'] for _,i in sp if not i['model']))
# per phase spawn counts: executors vs others; double spawn parallel executors?
# desc classes of gp
def dc(d):
    d=(d or '').lower()
    for k,rx in [('review/verify',r'review|verify|audit|pre-?verif'),('test run',r'test|suite|bucket|run |preflight|integration|serve'),('docs',r'doc|summary'),('fix/impl',r'fix|implement|apply|execute|write|migrat|extract')]:
        if re.search(rx,d): return k
    return 'other'
gp=[(r,i) for r,i in sp if i['st'] in(None,'general-purpose')]
print('gp',len(gp),collections.Counter(dc(i['desc']) for _,i in gp).most_common())
# how many Agent calls are SendMessage-ish waits? prompt lengths
print('Edit attempts:')
for r in S:
    for e in P[r['path']]:
        if e[0]=='tu' and e[1]=='Edit': print('  ',bn(r),e[2]['p']); break
import random; random.seed(5)
oth=[(r,e[2]['cmd']) for r in S for e in P[r['path']] if e[0]=='tu' and e[1]=='Bash']
for r,c in random.sample(oth,12): print('  B',c[:150].replace('\n',' '))
