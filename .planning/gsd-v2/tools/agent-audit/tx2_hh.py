from tx2_d import *
for ro in ['gsd-plan-checker','gsd-verifier','gsd-debugger','reviewer']:
    c=collections.Counter()
    for p,v in ALL.items():
        if v[0]==ro and P[p].get('ended_err'):
            c[re.sub(r'\d+','N',(P[p].get('last_text') or v[4] or '')[:90])]+=1
    print(ro,c.most_common(4))
