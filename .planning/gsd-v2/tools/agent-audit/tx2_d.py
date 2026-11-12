from tx2_parse import *
ALL=pickle.load(open('tx2_all.pkl','rb'))
P={r['path']:r for r in R}
TEST=re.compile(r'deno (task )?test|nx test|vitest|npm (run )?test|run-integration|preflight|deno task test')
def stats(ro):
    rows=[]
    for p,(rr,calls,order,res,final) in ALL.items():
        if rr!=ro: continue
        r=P[p]
        bc=collections.Counter(); reads=collections.Counter(); spawns=[]; tests=0; testcmds=collections.Counter()
        for i in order:
            n,inp=calls[i]
            if n=='Bash':
                c=norm(inp.get('command','')); bc[c]+=1
                if TEST.search(c): tests+=1; testcmds[c]+=1
            elif n=='Read': reads[inp.get('file_path')]+=1
            elif n in('Agent','Task'): spawns.append((inp.get('subagent_type'),inp.get('model'),(inp.get('description') or '')[:40]))
        dupb=sum(v-1 for v in bc.values() if v>1)
        dupr=sum(v-1 for v in reads.values() if v>1)
        rows.append(dict(p=os.path.basename(p),model=lib.model(r),usd=lib.tokens(r)[4],nb=sum(bc.values()),dupb=dupb,nr=sum(reads.values()),dupr=dupr,tests=tests,duptests=sum(v-1 for v in testcmds.values() if v>1),spawns=spawns,ctx=r['max_ctx'],final=final or '',err=r.get('ended_err'),ac=r.get('api_errors'),topdup=bc.most_common(2),desc=r['meta'].get('description')))
    return rows
if __name__=='__main__':
    for ro in ['gsd-verifier','gsd-plan-checker']:
        rows=stats(ro); n=len(rows)
        print('==',ro,n,'usd',round(sum(x['usd'] for x in rows)),'avg usd',round(sum(x['usd'] for x in rows)/n,1))
        print('avg Bash',sum(x['nb'] for x in rows)/n,'avg dupBash',sum(x['dupb'] for x in rows)/n,'avg Read',sum(x['nr'] for x in rows)/n,'avg dupRead',sum(x['dupr'] for x in rows)/n)
        print('with tests',sum(1 for x in rows if x['tests']),'avg test runs',sum(x['tests'] for x in rows)/n,'rows w/ duptests',sum(1 for x in rows if x['duptests']),'sum duptests',sum(x['duptests'] for x in rows))
        sp=[s for x in rows for s in x['spawns']]
        print('spawns total',len(sp),'agents spawning',sum(1 for x in rows if x['spawns']),collections.Counter((s[0],s[1]) for s in sp).most_common(8))
        for x in sorted(rows,key=lambda x:-x['usd'])[:5]: print({k:(str(v)[:120]) for k,v in x.items() if k not in('final','topdup','spawns')},len(x['spawns']))
