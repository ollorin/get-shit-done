import sys,json

sys.path.insert(0,".")
from lib import *
def ep(ts): return __import__("datetime").datetime.fromisoformat(ts[:-1]+'+00:00').timestamp()
R=load()
pat=sys.argv[1]; n=int(sys.argv[2]) if len(sys.argv)>2 else 1
M=[r for r in R if r['kind']=='sub' and pat in (r['meta'].get('description') or '')]
r=M[0]
print(r['meta'].get('description'),r['path'])
tu={}
t00=None
for line in open(r['path'],errors='replace'):
    if line.startswith('{"type":'): continue
    try: d=json.loads(line)
    except: continue
    ts=d.get('timestamp')
    if not ts or d.get('type') not in('assistant','user'): continue
    e=ep(ts); t00=t00 or e
    c=(d.get('message') or {}).get('content')
    if not isinstance(c,list): continue
    for b in c:
        if b.get('type')=='tool_use':
            inp=b.get('input') or {}
            tu[b['id']]=(e,b['name'],str(inp.get('command') or inp.get('file_path') or inp.get('description') or '')[:int(sys.argv[3]) if len(sys.argv)>3 else 220])
        elif b.get('type')=='tool_result' and b.get('tool_use_id') in tu:
            a=tu.pop(b['tool_use_id']); print('%6.0f +%5.0fs %-6s %s'%(a[0]-t00,e-a[0],a[1],a[2].replace('\n',' | ')))
