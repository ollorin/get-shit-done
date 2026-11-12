from tx2_d import *
for ro in ['gsd-plan-checker','gsd-verifier']:
    S=sel(ro)
    fp=[len(r['first_prompt'] or '') for r in S]
    print(ro,'first_prompt len med',lib.pct(fp,50),'max',max(fp))
# first_prompt in index maybe truncated? check
r=sel('gsd-plan-checker')[3]
for e in events(r['path']):
    m=e.get('message')
    if e.get('type')=='user' and isinstance(m,dict):
        c=m['content']; 
        if isinstance(c,list): c=' '.join(b.get('text','') for b in c if b.get('type')=='text')
        print(len(c)); print(c[:3500]); break
