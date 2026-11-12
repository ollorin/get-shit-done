from tx2_d import *
for ro in ['gsd-verifier','gsd-plan-checker']:
    rows=stats(ro)
    print('==',ro)
    kinds=collections.Counter()
    for x in rows:
        d=(x['desc'] or '').lower()
        k='diff-review' if 'diff' in d or 'review' in d else 'reverify' if 're-verif' in d or 'reverif' in d else 'verify' if 'verif' in d else 'plan-check' if 'plan' in d or 'check' in d else 'other'
        kinds[k]+=1
    print(kinds)
    # final format
    pats={'gsd-verifier':[r'## Verification Complete',r'Status: *\**(passed|gaps_found|human_needed)'],'gsd-plan-checker':[r'## VERIFICATION PASSED',r'## ISSUES FOUND']}[ro]
    for pt in pats: print(pt,sum(1 for x in rows if re.search(pt,x['final'],re.I)),'/',len(rows))
    print('either',sum(1 for x in rows if any(re.search(pt,x['final'],re.I) for pt in pats)))
    print('final len med',lib.pct([len(x['final']) for x in rows],50),'p90',lib.pct([len(x['final']) for x in rows],90))
    for x in rows:
        if not any(re.search(pt,x['final'],re.I) for pt in pats): print('  NOFMT',x['p'],(x['desc'] or '')[:50],'|',x['final'][:150].replace('\n',' '))
