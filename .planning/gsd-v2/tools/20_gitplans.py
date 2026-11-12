import re,collections,statistics
rows=[l.rstrip('\n').split('\t',2) for l in open('out/gitlog.tsv')]
rows=[(h,int(t),s) for h,t,s in rows if len(rows[0])==3]
P=collections.defaultdict(list)
rx=re.compile(r'^(\w+)\(((?:\d{3}(?:\.\d)?)-\d{2}[a-z]?)\)')
for h,t,s in rows:
    m=rx.match(s)
    if m: P[m.group(2)].append((t,m.group(1),s))
print('plan-scoped commits',sum(len(v) for v in P.values()),'plans',len(P),'of',len(rows),'commits')
spans=[];cnt=[];types=collections.Counter()
for p,v in P.items():
    v.sort(); 
    if len(v)>=3: spans.append((v[-1][0]-v[0][0])/3600); cnt.append(len(v))
    for _,ty,_ in v: types[ty]+=1
print('plans with >=3 commits',len(spans),'span h: median %.1f p90 %.1f mean %.1f; commits/plan median %d p90 %d'%(statistics.median(spans),sorted(spans)[int(.9*(len(spans)-1))],statistics.mean(spans),statistics.median(cnt),sorted(cnt)[int(.9*(len(cnt)-1))]))
print(types.most_common(10))
# share of commit subjects mentioning review/fix round/evidence/mutation
tx=[s for _,_,s in rows]
for name,rxx in[('review',r'review'),('mutation|mutant',r'mutation|mutant'),('evidence|register|ledger|findings',r'evidence|register|ledger|findings'),('summary|state',r'summary|state\b|roadmap'),('bucket|run|green',r'bucket|green|runs?\b')]:
    n=sum(1 for s in tx if re.search(rxx,s,re.I)); print(name,n,'%.1f%%'%(100*n/len(tx)))
