import sys,json,glob,os,collections
from datetime import datetime
def ep(ts): return datetime.fromisoformat(ts[:-1]+'+00:00').timestamp()
D=collections.defaultdict(lambda:[0,0.0,[]])
base=os.path.expanduser('~/.claude/projects/<project-slug>-apps-e2e-charlotte/')
gaps=[0.0,0.0] # model gen vs tool
for p in glob.glob(base+'*.jsonl'):
    tu={}
    for line in open(p,errors='replace'):
        if line.startswith('{"type":'): continue
        if 'mcp__charlotte' not in line and '"tool_use_id"' not in line: continue
        try: d=json.loads(line)
        except: continue
        c=(d.get('message') or {}).get('content')
        if not isinstance(c,list): continue
        for b in c:
            if b.get('type')=='tool_use' and b['name'].startswith('mcp__charlotte'): tu[b['id']]=(ep(d['timestamp']),b['name'].replace('mcp__charlotte__charlotte_',''))
            elif b.get('type')=='tool_result' and b.get('tool_use_id') in tu:
                t0,n=tu.pop(b['tool_use_id']); x=D[n]; x[0]+=1; x[1]+=ep(d['timestamp'])-t0; x[2].append(ep(d['timestamp'])-t0)
tot=sum(v[1] for v in D.values())
print('| tool | calls | total s | mean s | p90 s | % of charlotte tool time |')
for k,v in sorted(D.items(),key=lambda x:-x[1][1])[:12]:
    a=sorted(v[2]); print('| %s | %d | %.0f | %.1f | %.1f | %.1f%% |'%(k,v[0],v[1],v[1]/v[0],a[int(.9*(len(a)-1))],100*v[1]/tot))
