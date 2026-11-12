from common import *
S=rs('gsd-planner')
# how do planners modify existing plans (no Edit tool)?
c=collections.Counter(); ex={}
for r in S:
    for e in P[r['path']]:
        if e[0]=='tu' and e[1]=='Bash':
            cmd=e[2]['cmd']
            if re.search(r'PLAN\.md',cmd):
                if re.search(r"python3?\s*(-|<<)|python3 -c",cmd) and re.search(r'write|open\(',cmd): k='python rewrite of PLAN.md'
                elif re.search(r'sed -i|perl -[pi]',cmd): k='sed -i PLAN.md'
                elif re.search(r'cat\s*>|tee ',cmd): k='cat> PLAN.md'
                else: continue
                c[k]+=1; ex.setdefault(k,bn(r))
print(c,ex)
print('planner transcripts by description kind:')
d=collections.Counter()
for r in S:
    x=(r['meta'].get('description') or '').lower()
    d['revise/fix' if re.search(r'revis|fix|round|check',x) else 'plan']+=1
print(d)
import random; random.seed(4)
for r in random.sample(S,12): print(r['meta'].get('model'),'|',r['meta'].get('description'),'|',round((r['t1']-r['t0'])/60),'min', r['max_ctx'])
