from common import *
S=rs('gsd-executor'); c=collections.Counter(); ex={}
for r in S:
    for e in P[r['path']]:
        if e[0]=='tr' and e[5]:
            s=re.sub(r'\d+','N',e[3][:70]).replace('\n',' ')
            if s.startswith('Exit code'): s=re.sub(r'Exit code N\s*','Exit code: ',s)[:40]
            c[s]+=1; ex.setdefault(s,bn(r))
for k,v in c.most_common(25): print(v,k,ex[k])
