from tx2_d import *
ST=re.compile(r'deno (task )?test|nx test|vitest run|run-integration-tests|deno test')
for ro in ['gsd-verifier','gsd-plan-checker','gsd-test-writer','gsd-debugger','gsd-docs-updater','gsd-charlotte-qa']:
    n=0;w=0;tot=0;dup=0;worst=[];sumdup=0
    for p,(rr,calls,order,res,final) in ALL.items():
        if rr!=ro: continue
        n+=1; cmds=collections.Counter()
        for i in order:
            if calls[i][0]=='Bash':
                c=calls[i][1].get('command','')
                if ST.search(c) and not re.search(r'^\s*(cat|grep|sed)\b',c):
                    # key = command minus pipes
                    k=re.sub(r'\s*\|.*','',re.sub(r'\s*2>&1','',norm(c)))
                    cmds[k]+=1
        t=sum(cmds.values()); tot+=t; w+=bool(t); d=sum(v-1 for v in cmds.values()); dup+=d; sumdup+=bool(d)
        worst.append((t,d,os.path.basename(p),cmds.most_common(1)[0] if cmds else None))
    worst.sort(reverse=True)
    print(ro,'n',n,'with strict test run',w,'avg runs',round(tot/n,1),'identical re-runs',dup,'in',sumdup,'transcripts'); 
    for x in worst[:2]: print('   ',str(x)[:260])
