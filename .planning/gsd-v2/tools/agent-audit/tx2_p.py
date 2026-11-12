from tx2_d import *
for ro in ['gsd-verifier','gsd-plan-checker','gsd-test-writer','gsd-debugger','reviewer']:
    hit=set();tot=0;ex=None
    for p,(rr,calls,order,res,final) in ALL.items():
        if rr!=ro: continue
        for i in order:
            if calls[i][0]!='Bash': continue
            cmd=calls[i][1].get('command','')
            for line in re.split(r'&&|;|\n',cmd):
                if re.match(r'\s*(cd \S+\s*)?(\w+=\S+\s+)*deno test\b.*--no-check',line.strip()) or re.match(r'\s*(\w+=\S+\s+)*deno test\b',line.strip()) and '--no-check' in cmd:
                    hit.add(p);tot+=1; ex=ex or (os.path.basename(p),line.strip()[:150])
    print(ro,tot,len(hit),ex)
