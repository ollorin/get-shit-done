from tx2_d import *
PR=pickle.load(open('tx2_prompts.pkl','rb'))
S=[(p,v) for p,v in ALL.items() if v[0]=='gsd-test-writer']
ST=re.compile(r'deno (task )?test|nx test|vitest|deno test|run-integration')
for p,(rr,calls,order,res,final) in S:
    B=[calls[i][1].get('command','') for i in order if calls[i][0]=='Bash']
    ran=any(ST.search(b) for b in B)
    r=P[p]
    print(os.path.basename(p)[:18],lib.model(r)[:7],round(lib.tokens(r)[4],1),'ran' if ran else 'NORUN',r['ended_err'], (r['meta'].get('description') or '')[:55],'|',(final or '')[:90].replace('\n',' '))
