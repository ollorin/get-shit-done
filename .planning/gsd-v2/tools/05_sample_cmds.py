import json,sys,os,glob,re,collections
sys.path.insert(0,'.')
from lib import *
from datetime import datetime
def ep(ts): return datetime.fromisoformat(ts[:-1]+'+00:00').timestamp()
R=load()
want=sys.argv[1:]
rows=[]
for r in R:
    if r['meta'].get('agentType') not in('gsd-executor','general-purpose','gsd-phase-coordinator') and r['kind']!='top': continue
    tu={}
    for line in open(r['path'],errors='replace'):
        if line.startswith('{"type":'): continue
        if '"name":"Bash"' not in line and '"tool_use_id"' not in line: continue
        try: d=json.loads(line)
        except: continue
        c=(d.get('message') or {}).get('content')
        if not isinstance(c,list): continue
        for b in c:
            if b.get('type')=='tool_use' and b.get('name')=='Bash':
                tu[b['id']]=(ep(d['timestamp']),str((b.get('input') or {}).get('command')))
            elif b.get('type')=='tool_result' and b.get('tool_use_id') in tu:
                t0,cmd=tu.pop(b['tool_use_id']); dur=ep(d['timestamp'])-t0
                if dur>600: rows.append((round(dur),role(r),(r['meta'].get('description') or '')[:40],cmd[:230].replace('\n',' ⏎ ')))
rows.sort(reverse=True)
import random
random.seed(3)
print(len(rows))
for x in rows[:40]: print(x)
print('---- random sample >10min')
for x in random.sample(rows,min(40,len(rows))): print(x)
