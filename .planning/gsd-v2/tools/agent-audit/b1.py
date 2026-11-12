from common import *
for role in ['gsd-executor','gsd-phase-coordinator','gsd-planner']:
    S=rs(role); print('==',role,len(S))
    ev0=P[S[0]['path']]
    # compact events present?
    print('compact evs', sum(1 for r in S for e in P[r['path']] if e[0]=='compact'), 'vs api_errors compact', sum((r.get('api_errors') or {}).get('compact_boundary',0) for r in S))
    # stop reasons
    print(collections.Counter(str(r.get('stop')) for r in S).most_common(3))
    # last_text endings
    import random; random.seed(1)
    for r in random.sample(S,6): print(bn(r),'|',(r.get('last_text') or '')[:200].replace('\n',' '))
