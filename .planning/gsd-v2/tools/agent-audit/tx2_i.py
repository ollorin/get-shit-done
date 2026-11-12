from tx2_d import *
def cat(c):
    c=c.strip()
    for pt,n in [(r'^(cd [^&;]+(&&|;) *)?(rtk )?git ','git'),(r'deno (task )?test|nx test|vitest|run-integration','test-run'),(r'deno (check|lint|fmt)|nx (lint|typecheck)|tsc','static'),(r'gsd-tools','gsd-tools'),(r'scripts/|\.ts\b|preflight','script'),(r'\bpsql\b|docker exec|supabase','db'),(r'curl','curl'),(r'\b(cat|sed|head|tail|wc|ls|stat)\b','file-inspect'),(r'\b(grep|rg|zg|find)\b','search'),(r'python3?','python')]:
        if re.search(pt,c): return n
    return 'other'
for ro in ['gsd-verifier','gsd-plan-checker','gsd-docs-updater','gsd-test-writer','gsd-debugger','gsd-charlotte-qa']:
    C=collections.Counter(); big=[]
    for p,(rr,calls,order,res,final) in ALL.items():
        if rr!=ro: continue
        for i in order:
            n,inp=calls[i]
            L=len(res.get(i,''))
            if n=='Bash': C[cat(inp.get('command',''))]+=1
            else: C['T:'+n]+=1
            big.append((L,os.path.basename(p),n,(inp.get('command') or inp.get('file_path') or str(inp))[:100].replace('\n',' ')))
    big.sort(reverse=True)
    print('==',ro,C.most_common(14)); print(' total res chars',sum(b[0] for b in big),'n>20k',sum(1 for b in big if b[0]>20000))
    for b in big[:4]: print('  ',b)
