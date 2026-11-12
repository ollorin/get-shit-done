import sys,json,collections; sys.path.insert(0,'.')
from lib import *
R=load()
import random; random.seed(5)
out=[]
for ro,tr in(('general-purpose','haiku'),('gsd-executor','haiku'),('gsd-planner','opus'),('gsd-verifier','opus'),('gsd-plan-checker','opus')):
    L=[r for r in R if role(r)==ro and rtier(r)==tr and r['first_turn'] and sum(r['first_turn'][1:4])>10000 and r['shape']]
    for r in random.sample(L,min(12,len(L))):
        chars=0; parts=collections.Counter()
        seen_first=False
        for line in open(r['path'],errors='replace'):
            if line.startswith('{"type":"api-request-shape"'): continue
            if line.startswith('{"type":"api-request'): continue
            try: d=json.loads(line)
            except: continue
            if d['type']=='assistant': break
            if d['type']=='attachment':
                for x in d.get('rendered') or []:
                    parts[d['attachment']['type']]+=len(x.get('content',''))
            elif d['type']=='user':
                c=d['message']['content']
                parts['user_prompt']+=len(c) if isinstance(c,str) else sum(len(b.get('text','')) for b in c)
        parts['system']=r['shape']['system_chars']; parts['tools']=r['shape']['tools_chars']
        tot=sum(parts.values()); ft=sum(r['first_turn'][1:4])
        out.append((ro,tr,ft,tot,tot/ft,dict(parts)))
for o in out[:60]: print(o[0],o[1],o[2],o[3],round(o[4],2))
print('median chars/token',statistics.median([o[4] for o in out]))
# print one decomposition per role
seen=set()
for o in out:
    if o[0] in seen: continue
    seen.add(o[0]); print(o[0],o[2],sorted(o[5].items(),key=lambda x:-x[1])[:9])
