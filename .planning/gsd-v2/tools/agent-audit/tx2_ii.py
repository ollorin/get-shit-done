from tx2_d import *
for ro in ['gsd-verifier','gsd-plan-checker','gsd-test-writer','gsd-debugger','gsd-docs-updater','gsd-charlotte-qa']:
    tc=collections.Counter(); per=collections.defaultdict(set)
    for p,v in ALL.items():
        if v[0]!=ro: continue
        for i in v[2]: tc[v[1][i][0]]+=1; per[v[1][i][0]].add(p)
    n=sum(1 for p,v in ALL.items() if v[0]==ro)
    print(ro,n,{k.replace('mcp__charlotte__charlotte_','C:'):(c,len(per[k])) for k,c in tc.most_common(14)})
