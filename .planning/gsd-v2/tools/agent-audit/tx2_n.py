from tx2_d import *
ST=re.compile(r'deno (task )?test|nx test|vitest run|deno test')
for ro in ['gsd-verifier','gsd-plan-checker','gsd-test-writer','gsd-debugger','gsd-docs-updater','gsd-charlotte-qa','reviewer']:
    c=collections.Counter(); agents=collections.defaultdict(set); n=0; tr=0
    for p,(rr,calls,order,res,final) in ALL.items():
        if rr!=ro: continue
        n+=1
        for i in order:
            if calls[i][0]!='Bash': continue
            cmd=calls[i][1].get('command','')
            if not ST.search(cmd) or re.match(r'\s*(cat|grep|sed|git|ls)\b',cmd): continue
            tr+=1
            for k,pt in [('no-check',r'--no-check'),('inline-env',r'(^|[;&]\s*|&&\s*)(?:cd \S+ && )?[A-Z_]{4,}=\S+ +(deno|npx)'),('pipe-tail/grep',r'\|\s*(tail|grep|head|rg|tee)'),('semicolon-chain',r';\s*(deno|cd|echo)'),('heredoc/$()',r'<<|\$\('),('bash -c',r'bash -c')]:
                if re.search(pt,cmd): c[k]+=1; agents[k].add(p)
    print(ro,'test cmds',tr,{k:(v,len(agents[k])) for k,v in c.items()})
