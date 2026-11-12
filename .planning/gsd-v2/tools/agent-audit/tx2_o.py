from tx2_d import *
PAT=re.compile(r"permission|not allowed|denied|requires approval|was blocked|hook|blocked by",re.I)
for ro in ['gsd-verifier','gsd-plan-checker','gsd-test-writer','gsd-debugger','gsd-docs-updater','gsd-charlotte-qa','reviewer']:
    n=0;hit=0;tr=0;ex=collections.Counter();pn=set()
    for p,(rr,calls,order,res,final) in ALL.items():
        if rr!=ro: continue
        n+=1
        for i in order:
            t=res.get(i,'')
            if len(t)<600 and PAT.search(t) and calls[i][0] in('Bash','Write','Edit','Read'):
                hit+=1; pn.add(p); ex[re.sub(r'\d+','N',t[:110].replace('\n',' '))]+=1
    print(ro,n,'denial-like short results',hit,'in',len(pn),'transcripts'); 
    for k,v in ex.most_common(3): print('    ',v,k)
