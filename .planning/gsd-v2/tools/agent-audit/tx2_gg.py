from tx2_d import *
for ro in ['gsd-verifier','gsd-plan-checker','gsd-test-writer','gsd-debugger','gsd-docs-updater','gsd-charlotte-qa','reviewer']:
    S=[(p,v) for p,v in ALL.items() if v[0]==ro]
    comp=[P[p] for p,v in S if P[p].get('api_errors')]
    big=[P[p] for p,v in S if P[p]['max_ctx']>200000]
    print(ro,len(S),'compacted',len(comp),'ctx>200k',len(big),'ended_err',sum(1 for p,v in S if P[p].get('ended_err')),'usd of >200k',round(sum(lib.tokens(r)[4] for r in big)),'of total',round(sum(lib.tokens(P[p])[4] for p,v in S)))
# what are the context growth for compacted plan-checker
p=[p for p,v in ALL.items() if os.path.basename(p)=='agent-a011cf196cbfeb1fd.jsonl'][0]
v=ALL[p]; cats=collections.Counter()
for i in v[2]:
    cats[v[1][i][0]]+=len(v[3].get(i,''))
print(cats.most_common(4), 'tools',len(v[2]))
r=P[p]; print(r['api_errors'],r.get('api_err_list'), r['n_msgs'] if 'n_msgs' in r else '')
