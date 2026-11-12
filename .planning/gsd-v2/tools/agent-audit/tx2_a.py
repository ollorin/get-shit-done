from tx2_base import *
print(len(R)); print(collections.Counter(lib.role(r) for r in R).most_common(30))
for ro in ROLES+['reviewer']:
    S=sel(ro); 
    if not S: print(ro,0); continue
    print(ro,len(S),'models',collections.Counter(lib.model(r) for r in S),'err',sum(1 for r in S if r.get('ended_err')),'api_err',sum(1 for r in S if r.get('api_errors')),'maxctx med',lib.pct([r['max_ctx'] for r in S],50),'max',max(r['max_ctx'] for r in S),'usd',round(sum(lib.tokens(r)[4] for r in S)))
r=sel('gsd-verifier')[0]; print({k:(str(v)[:100]) for k,v in r.items()})
