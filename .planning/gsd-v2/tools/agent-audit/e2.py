from common import *
S=rs('gsd-executor')
def cls(d):
    d=(d or '').lower()
    for k,rx in [('execute plan',r'^execute|exec |plan \d|executor'),('fix/finding',r'fix|finding|review|repair'),('mutation/proof',r'mutat|proof|probe'),('test/run',r'test|run |suite|preflight'),('docs',r'doc|summary'),('resume/continue',r'resum|continu|handoff|retry|redo')]:
        if re.search(rx,d): return k
    return 'other'
c=collections.Counter(cls(r['meta'].get('description')) for r in S); print(c)
print(collections.Counter(r['meta'].get('model') for r in S))
print(collections.Counter(r['meta'].get('spawnDepth') for r in S))
import random; random.seed(3)
for r in random.sample(S,25): print(r['meta'].get('description'),'|',r['meta'].get('model'),'|',(r.get('first_prompt') or '')[:100].replace('\n',' '))
