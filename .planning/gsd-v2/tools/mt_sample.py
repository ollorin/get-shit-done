import sys,json,random,collections
sys.path.insert(0,'.')
from mt_analyze import *
import datetime as _d
def ep(ts): return _d.datetime.fromisoformat(ts[:-1]+'+00:00').timestamp()
random.seed(int(sys.argv[1]) if len(sys.argv)>1 else 1)
cand=[x for x in X if mode(x)=='win']
random.shuffle(cand)
shown=0
for x in cand:
    iv,am,_=attrib(x,'mid'); _,al,_=attrib(x,'low')
    if am<600: continue
    shown+=1
    if shown>int(sys.argv[2]) if len(sys.argv)>2 else 4: break
    print('=====',x['tagged'],x['desc'],x['role'],x['model'],'mid %.0fs low %.0fs tot %.0fs'%(am,al,total(x)[0]),'wins',[(round(a-x['t0']),round(b-x['t0'])) for a,b in iv])
    tu={}; buf=[]
    for line in open(x['path'],errors='replace'):
        if line.startswith('{"type":'): continue
        try: d=json.loads(line)
        except: continue
        ts=d.get('timestamp')
        if not ts or d.get('type') not in('assistant','user'): continue
        e=ep(ts)
        c=(d.get('message') or {}).get('content')
        if not isinstance(c,list): continue
        for b in c:
            if b.get('type')=='tool_use':
                inp=b.get('input') or {}
                tu[b['id']]=(e,b['name'],str(inp.get('command') or inp.get('file_path') or inp.get('description') or ''))
            elif b.get('type')=='tool_result' and b.get('tool_use_id') in tu:
                a=tu.pop(b['tool_use_id'])
                if any(w0<=a[0]<=w1 for w0,w1 in iv): buf.append('  %6.0f +%4.0fs %-6s %s'%(a[0]-x['t0'],e-a[0],a[1],a[2].replace('\n',' | ')[:170]))
    print('\n'.join(buf[:9]+['   ...(%d calls in windows)'%len(buf)]+buf[-3:]) if len(buf)>12 else '\n'.join(buf))
