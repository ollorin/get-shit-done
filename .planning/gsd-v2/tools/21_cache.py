import sys,json,collections; sys.path.insert(0,'.')
from lib import *
from datetime import datetime
def ep(ts): return datetime.fromisoformat(ts[:-1]+'+00:00').timestamp()
R=load()
B=collections.defaultdict(lambda:[0,0,0,0])  # n, ctx sum, cc sum, cr sum
def bk(w):
    return '<60s' if w<60 else '60-240s' if w<240 else '240-300s' if w<300 else '300-600s' if w<600 else '>600s'
for grp in(('gsd-phase-coordinator',),('gsd-executor','general-purpose'),):
    B.clear()
    for r in R:
        if role(r) not in grp: continue
        if rtier(r) not in('sonnet','haiku','opus'): continue
        if r['t0']<1791100000 and False: continue
        seen=set(); last_asst=None; last_user=None
        for line in open(r['path'],errors='replace'):
            if line.startswith('{"type":'): continue
            if '"type":"assistant"' not in line[:400] and '"type":"user"' not in line[:400] and '"role"' not in line[:500]: continue
            try: d=json.loads(line)
            except: continue
            t=d.get('type')
            if t not in('assistant','user') or not d.get('timestamp'): continue
            e=ep(d['timestamp'])
            if t=='user': last_user=e; continue
            m=d['message']; mid=m.get('id')
            if mid in seen: last_asst=e; continue
            seen.add(mid)
            u=m.get('usage') or {}
            ctx=(u.get('input_tokens') or 0)+(u.get('cache_creation_input_tokens') or 0)+(u.get('cache_read_input_tokens') or 0)
            if last_asst is not None and last_user is not None and last_user>=last_asst and ctx>20000 and not d.get('isApiErrorMessage'):
                w=last_user-last_asst; x=B[bk(w)]; x[0]+=1; x[1]+=ctx; x[2]+=u.get('cache_creation_input_tokens') or 0; x[3]+=u.get('cache_read_input_tokens') or 0
            last_asst=e
    print(grp)
    for k in('<60s','60-240s','240-300s','300-600s','>600s'):
        x=B[k]
        if x[0]: print('  wait before turn %-9s turns %6d  mean ctx %6d  cache-write share of ctx %.1f%%  cache-read share %.1f%%'%(k,x[0],x[1]/x[0],100*x[2]/x[1],100*x[3]/x[1]))
