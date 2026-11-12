import sys; sys.path.insert(0,'<home>/get-shit-done/scripts/gsd-metrics')
import lib, collections, json, os, statistics as st
R=lib.load()
for role in ['gsd-executor','gsd-phase-coordinator','gsd-planner']:
    rs=[r for r in R if lib.role(r)==role]
    mc=[r.get('max_ctx') or 0 for r in rs]
    comp=[(r.get('api_errors') or {}).get('compact_boundary',0) for r in rs]
    err=[r.get('ended_err') for r in rs]
    dur=[(r['t1']-r['t0'])/60 for r in rs]
    print(role,len(rs),'maxctx med',st.median(mc),'p90',sorted(mc)[int(.9*len(mc))],'compacted',sum(1 for c in comp if c),'ended_err',sum(1 for e in err if e),'dur med min',round(st.median(dur)))
    print(' meta keys sample',rs[0]['meta'], list(rs[0].keys())[:50])
    print(' tool_counts top', collections.Counter(sum((collections.Counter(r['tool_counts']) for r in rs),collections.Counter())).most_common(15))
