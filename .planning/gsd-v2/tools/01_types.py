import json,sys,collections,re
c=collections.Counter(); sub=collections.Counter()
for p in sys.argv[1:]:
  with open(p) as f:
    for l in f:
        if l.startswith('{"type":"api-request'): c['api-req']+=1; continue
        m=re.search(r'"type":"(\w[\w-]*)"',l[:3000])
        d=json.loads(l)
        t=d.get('type'); c[t]+=1
        if t=='system': sub[(d.get('subtype'),d.get('level'))]+=1
        if t not in('user','assistant','attachment','system') and c[t]<3: print(t,str(d)[:400])
print(c); print(sub)
