from tx2_d import *
for ro in ['gsd-verifier','gsd-plan-checker','gsd-test-writer','gsd-debugger','gsd-docs-updater','gsd-charlotte-qa','reviewer']:
    n=0;big=0;bigchars=0;allres=0;nodiv=0;cat_big=0;trans=0;transbig=set(); readchars=0
    for p,(rr,calls,order,res,final) in ALL.items():
        if rr!=ro: continue
        trans+=1
        for i in order:
            L=len(res.get(i,'')); allres+=L
            nm,inp=calls[i]
            if nm=='Read':
                n+=1; readchars+=L
                if L>30000 and not inp.get('limit'): big+=1; bigchars+=L; transbig.add(p)
            if nm=='Bash' and L>30000: cat_big+=1
    print(ro,'transcripts',trans,'Read calls',n,'full-file Reads >30k chars',big,'in',len(transbig),'transcripts','(~%dk tok)'%(bigchars//4000),'| Bash results>30k',cat_big,'| total tool-result chars/transcript avg %dk'%(allres/trans/1000),'| Read share %d%%'%(100*readchars/max(allres,1)))
