import sys,collections,json,os
sys.path.insert(0,'<home>/get-shit-done/scripts/gsd-metrics')
import lib
R=lib.load()
TPB=0.40  # tok/byte measured 01 §2a (executor 12389/30704 etc.)
st={r['agent']:r for r in json.load(open('stats.json'))}
target={'gsd-executor':12000,'gsd-phase-coordinator':10000,'gsd-planner':14000,'gsd-plan-checker':15000,'gsd-verifier':12500,
'gsd-docs-updater':6000,'gsd-test-writer':6000,'gsd-debugger':10000,'gsd-charlotte-qa':12000,'gsd-phase-researcher':10000,
'gsd-project-researcher':9000,'gsd-research-synthesizer':5000,'gsd-roadmapper':11000,'gsd-codebase-mapper':8000,'gsd-integration-checker':7000,
'gsd-e2e-test-generator':9000,'gsd-discovery-synthesizer':3649,'gsd-product-investigator':4840,
'gsd-plan-attacker':0,'gsd-plan-defender':0,'gsd-plan-judge':0,'gsd-task-router':0,'gsd-meta-answerer':0,'gsd-nyquist-auditor':0,'gsd-integration-tester':0,'gsd-ui-inventory':0,'gsd-qa-analyst':0}
by=collections.defaultdict(list)
for r in R:
    if r['kind']=='top' or r['proj'].endswith('charlotte'): continue
    by[lib.role(r)].append(r)
rows=[]
for a,s in st.items():
    rs=by.get(a,[]); d=(s['bytes']-target[a])*TPB
    usd=0; turns=[]
    for r in rs:
        t=sum(v[0] for v in r['tok'].values()); turns.append(t)
        p=lib.PRICE.get(lib.rtier(r),2.05)
        usd+=d*(1.25+0.1*max(t-1,0))*p/1e6
    est=sum(lib.tokens(r)[-1] if False else 0 for r in rs)
    rows.append((a,len(rs),s['bytes'],round(s['bytes']*TPB),target[a],round(usd,1),sorted(turns)[len(turns)//2] if turns else 0))
for x in sorted(rows,key=lambda x:-x[5]): print(x)
