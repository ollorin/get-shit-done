from tx2_d import *
import sys
ro=sys.argv[1]
C=collections.Counter()
for p,(rr,calls,order,res,final) in ALL.items():
    if rr!=ro: continue
    for i in order:
        n,inp=calls[i]
        if n=='Bash':
            c=inp.get('command','').strip()
            c=re.sub(r'^cd \S+ *(&&|;) *','',c)
            c=re.sub(r'^rtk ','',c)
            toks=c.split()[:3]
            C[' '.join(toks)[:50]]+=1
print(C.most_common(int(sys.argv[2])))
