import sys,json,collections,os; sys.path.insert(0,'.')
from lib import *
from datetime import datetime
from multiprocessing import Pool
def ep(ts): return datetime.fromisoformat(ts[:-1]+'+00:00').timestamp()
R=load()
def work(r):
    seen=set(); last_asst=None; last_user=None
    miss_cc=0; miss_n=0; tot_cc=0; first_cc=0; n=0
    for line in open(r['path'],errors='replace'):
        if line.startswith('{"type":'): continue
        h=line[:400]
        if '"type":"assistant"' not in h and '"type":"user"' not in h and '"role"' not in line[:600]: continue
        try: d=json.loads(line)
        except: continue
        t=d.get('type')
        if t not in('assistant','user') or not d.get('timestamp'): continue
        e=ep(d['timestamp'])
        if t=='user': last_user=e; continue
        m=d['message']; mid=m.get('id')
        if mid in seen: last_asst=e; continue
        seen.add(mid); n+=1
        u=m.get('usage') or {}
        cc=u.get('cache_creation_input_tokens') or 0
        tot_cc+=cc
        if n==1: first_cc=cc
        elif last_asst is not None and last_user is not None and last_user>=last_asst and (last_user-last_asst)>=300 and cc>20000:
            miss_cc+=cc; miss_n+=1
        last_asst=e
    return (r['path'],role(r),rtier(r),miss_n,miss_cc,tot_cc,first_cc)
if __name__=='__main__':
    with Pool(4) as p: out=p.map(work,[r for r in R if rtier(r) in('sonnet','haiku','opus')],chunksize=4)
    json.dump(out,open('out/cache_all.json','w'))
    A=collections.defaultdict(lambda:[0,0,0,0,0.0])
    for path,ro,tr,mn,mc,tc,fc in out:
        x=A[(ro,tr)]; x[0]+=mn; x[1]+=mc; x[2]+=tc; x[3]+=fc; x[4]+=mc*1.15*PRICE[tr]/1e6
    tot=sum(v[4] for v in A.values()); print('total extra $ from >=300s-idle cache misses (write 1.25x vs read 0.1x)',round(tot))
    for k,v in sorted(A.items(),key=lambda x:-x[1][4])[:10]: print(k,'miss turns',v[0],'rewritten M',round(v[1]/1e6),'of cache-write M',round(v[2]/1e6),'first-turn M',round(v[3]/1e6),'extra $',round(v[4]))
