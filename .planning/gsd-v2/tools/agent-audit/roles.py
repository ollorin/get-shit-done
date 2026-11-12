import sys,collections,statistics,json
sys.path.insert(0,'<home>/get-shit-done/scripts/gsd-metrics')
import lib
R=lib.load()
by=collections.defaultdict(list)
for r in R:
    if r['kind']=='top' or r['proj'].endswith('charlotte'): continue
    by[lib.role(r)].append(r)
out={}
for role,rs in sorted(by.items(),key=lambda x:-len(x[1])):
    if not role.startswith('gsd-') and role not in('general-purpose','Explore','fork'): continue
    tc=collections.Counter(); spawned=collections.Counter()
    for r in rs:
        for k,v in (r.get('tool_counts') or {}).items(): tc[k]+=v
        for k,v in (r.get('cat') or {}).items():
            if k.startswith('spawn:'): spawned[k[6:]]+=v[0]
    cost=sum((r.get('cost') or 0) for r in rs)
    mx=[r.get('max_ctx') or 0 for r in rs]
    comp=sum(1 for r in rs if (r.get('api_errors') or {}).get('compact_boundary'))
    err=sum(1 for r in rs if r.get('ended_err'))
    models=collections.Counter(lib.rtier(r) for r in rs)
    ft=[r['first_turn'][2]+r['first_turn'][3]+r['first_turn'][1] for r in rs if r.get('first_turn')]
    turns=[sum(v[0] for v in r['tok'].values()) for r in rs]
    out[role]=dict(n=len(rs),cost=round(cost,1),models=dict(models),maxctx_med=statistics.median(mx),maxctx_p90=lib.pct(mx,90),compacted=comp,ended_err=err,turns_med=statistics.median(turns),tools=dict(tc.most_common()),spawned=dict(spawned.most_common(6)))
    print(role,json.dumps(out[role]))
json.dump(out,open('<project-root>/.tmp/gsd-v2/agent-audit/roles.json','w'),indent=1)
