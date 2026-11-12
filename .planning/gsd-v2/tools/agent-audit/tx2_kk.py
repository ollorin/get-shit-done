from tx2_d import *
S=[(p,v) for p,v in ALL.items() if v[0]=='reviewer' and not re.search(r'\bfix',P[p]['meta'].get('description','') or '',re.I)]
V=collections.Counter()
for p,(rr,calls,order,res,final) in S:
    m=re.findall(r'\b(APPROVED WITH FINDINGS|APPROVED|CHANGES[_ ]REQUESTED|CHANGES[_ ]REQUIRED|NOT READY|READY|BLOCKED|REJECTED|PASS-WITH-FIXES|PASS|FAIL|ISSUES FOUND|FINDINGS|CLEAN|ZERO FINDINGS)\b',(final or '')[:400])
    V[m[0] if m else '-none-']+=1
print(V.most_common(15))
# time wasted by rerun rounds: per description key (phase/plan) number of review rounds
g=collections.defaultdict(int)
for p,v in S:
    d=(P[p]['meta'].get('description') or '').lower()
    m=re.search(r'(\d{3}(?:\.\d+)?(?:-\d+)?)',d)
    if m: g[m.group(1)]+=1
print('plan/phase keys',len(g),'with >=4 review dispatches',sum(1 for v in g.values() if v>=4),'max',max(g.values()),sorted(g.items(),key=lambda x:-x[1])[:5])
