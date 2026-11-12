import sys; sys.path.insert(0,'<home>/get-shit-done/scripts/gsd-metrics')
import lib, json
R=lib.load()
r=[r for r in R if lib.role(r)=='gsd-executor'][5]
print(r['path'], r['meta'])
with open(r['path']) as f:
    for i,l in enumerate(f):
        d=json.loads(l)
        if i<6 or i%200==0:
            print(i, {k:str(v)[:200] for k,v in d.items() if k in('type','subtype','isCompactSummary','toolUseResult')})
            m=d.get('message')
            if m: print('  ',str(m)[:400])
