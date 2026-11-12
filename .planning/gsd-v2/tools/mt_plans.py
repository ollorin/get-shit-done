import os,re,json,glob,collections,statistics
B='<project-root>/.planning/phases/'
PH={'398':'398-findings-register-reverification-program-substrate','399':'399-auth-sweep-a1-a4','400':'400-wallet-sweep-w1-w2','401':'401-payments-iap-fraud-withdrawal-resolution','402':'402-games-money-paths'}
MUT=re.compile(r'mutant|mutation|\bM\d+[a-z]?\b',re.I)
KW=re.compile(r'mutant|mutation',re.I)
# commits by plan
C=collections.defaultdict(list)
rx=re.compile(r'^\w+\((\d{3}(?:\.\d)?-\d{2}[a-z]?)')
for l in open('out/gitlog2.tsv'):
    h,t,s=l.rstrip('\n').split('\t',2)
    m=rx.match(s)
    if m: C[m.group(1)].append((int(t),s))
rows=[]
for ph,d in PH.items():
    for p in sorted(glob.glob(B+d+'/*-PLAN.md')):
        pid=os.path.basename(p)[:6]
        txt=open(p,errors='replace').read()
        m=re.search(r'<objective>\s*(.{0,300})',txt,re.S)
        obj=re.sub(r'\s+',' ',m.group(1))[:180] if m else ''
        tasks=re.findall(r'<name>(.*?)</name>',txt,re.S)
        mt=[t for t in tasks if KW.search(t)]
        sp=p.replace('-PLAN.md','-SUMMARY.md')
        st=open(sp,errors='replace').read() if os.path.exists(sp) else ''
        ids=set(re.findall(r'\bM\d+[a-z]?\b',st))
        evd=p.replace('-PLAN.md','-evidence')
        nev=sum(len(f) for _,_,f in os.walk(evd)) if os.path.isdir(evd) else 0
        nmut=sum(1 for _,_,f in (os.walk(evd) if os.path.isdir(evd) else []) for x in f if re.search(r'mut',x,re.I))
        c=sorted(C.get(pid,[]))
        rows.append(dict(phase=ph,plan=pid,obj=obj,ntasks=len(tasks),nmuttasks=len(mt),mut_in_plan=len(KW.findall(txt)),plan_chars=len(txt),mut_ids_summary=len(ids),sum_mut_mentions=len(KW.findall(st)),sum_chars=len(st),evid_files=nev,evid_mut_files=nmut,rulings=len(glob.glob(p.replace('-PLAN.md','-RULING*.md'))),verdicts=len(glob.glob(p.replace('-PLAN.md','-VERDICT*.md'))),ncommits=len(c),first=c[0][0] if c else None,last=c[-1][0] if c else None))
json.dump(rows,open('out/mt_plans.json','w'))
print(len(rows))
for ph in PH:
    R=[r for r in rows if r['phase']==ph]
    print(ph,'plans',len(R),'mut mentions in plans',sum(r['mut_in_plan'] for r in R),'plans w/ mutation task',sum(1 for r in R if r['nmuttasks']),'mut ids in summaries',sum(r['mut_ids_summary'] for r in R),'evid files',sum(r['evid_files'] for r in R),'mutation-named evid files',sum(r['evid_mut_files'] for r in R), 'commits',sum(r['ncommits'] for r in R))
