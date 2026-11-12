from tx2_d import *
for ro in ['gsd-verifier','gsd-plan-checker']:
    g=collections.defaultdict(list)
    for p,v in ALL.items():
        if v[0]!=ro: continue
        d=P[p]['meta'].get('description') or ''
        m=re.search(r'\b(\d{3}(?:\.\d+)?)\b',d)
        g[m.group(1) if m else '?'].append((lib.tokens(P[p])[4],os.path.basename(p)[:14]))
    print(ro,'phases',len(g),'multi-run phases',sum(1 for v in g.values() if len(v)>1))
    for k,v in sorted(g.items(),key=lambda x:-sum(a for a,b in x[1]))[:6]: print('  ',k,len(v),'runs $',round(sum(a for a,b in v),1))
# verifier: 'Explore/gp' spawns detail
for p,v in ALL.items():
    if v[0]=='gsd-verifier':
        sp=[(v[1][i][1].get('subagent_type'),v[1][i][1].get('model'),(v[1][i][1].get('description') or '')[:40]) for i in v[2] if v[1][i][0] in('Agent','Task')]
        if len(sp)>=2: print(os.path.basename(p),P[p]['meta'].get('description'),sp)
# per-file read counts across the role: which files read by most verifier transcripts
for ro in ['gsd-verifier','gsd-plan-checker']:
    C=collections.Counter()
    for p,v in ALL.items():
        if v[0]!=ro: continue
        C.update(set(v[1][i][1].get('file_path','') for i in v[2] if v[1][i][0]=='Read'))
    print(ro,C.most_common(6))
