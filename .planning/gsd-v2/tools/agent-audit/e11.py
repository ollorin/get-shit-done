from common import *
import statistics as st
for role in ['gsd-executor','gsd-phase-coordinator','gsd-planner']:
    S=rs(role)
    ft=[ (r['first_turn'][2] if isinstance(r['first_turn'],list) else 0)+(r['first_turn'][3] if isinstance(r['first_turn'],list) else 0) for r in S if r.get('first_turn')]
    print(role,'first-turn ctx tokens med',st.median(ft),'p90',sorted(ft)[int(.9*len(ft))])
    # instr
    ib=[sum(x[1] for x in (r.get('instr') or [])) for r in S]
    print('  instr chars med',st.median(ib), 'attb agent_listing med',st.median([(r.get('attb') or {}).get('agent_listing_delta',0) for r in S]),'deferred tools',st.median([(r.get('attb') or {}).get('deferred_tools_delta',0) for r in S]))
S=rs('gsd-executor'); print(S[3]['instr'][:12]); print(S[3]['attb'])
