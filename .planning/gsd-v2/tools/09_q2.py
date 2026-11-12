import sys; sys.path.insert(0,'.')
from lib import *
R=[r for r in load() if r['kind']=='sub' or True]
# calibration: tokens per char of tool results
rat=[]
for r in R:
    s=r['series']
    if len(s)<8 or r['api_errors'].get('compact_boundary'): continue
    chars=sum(v[1] for v in r['tool_res_chars'].values())
    if chars<20000: continue
    dctx=s[-1][0]-s[0][0]
    out=sum(v[4] for v in r['tok'].values())
    tt=dctx-out
    if tt>5000: rat.append(chars/tt)
print('chars/token (tool results) median %.2f p25 %.2f p75 %.2f n=%d'%(statistics.median(rat),pct(rat,25),pct(rat,75),len(rat)))
def tot(t): return t[1]+t[2]+t[3]
G=collections.defaultdict(list)
for r in R:
    if r['proj'].endswith('charlotte') or r['kind']=='top': continue
    ro=role(r)
    if ro=='fork': continue
    G[(ro,rtier(r))].append(r)
WORK=re.compile(r'^(edit:|spawn:|bash:(test|integration-test|mutation|preflight|stack-ops|gates-lint-check|coverage|charlotte))')
print('| role | model | n | first-turn ctx tok med (p10-p90) | ctx at first work turn med | turns before work med | Read-chars before work med |')
rows=[]
for (ro,mo),L in G.items():
    if len(L)<5: continue
    ft=[tot(r['first_turn']) for r in L if r['first_turn']]
    cw=[];tb=[];rb=[]
    for r in L:
        s=r['series']
        idx=None
        for i,x in enumerate(s):
            if x[2] and WORK.match(x[2]): idx=i;break
        if idx is None: continue
        cw.append(s[idx][0]); tb.append(idx+1)
        rb.append(sum(c for p,c,t in r['first_reads'] if t<=idx+1))
    rows.append((len(L),ro,mo,statistics.median(ft),pct(ft,10),pct(ft,90),statistics.median(cw) if cw else 0,statistics.median(tb) if tb else 0,statistics.median(rb) if rb else 0))
for x in sorted(rows,reverse=True):
    print('| %s | %s | %d | %d (%d-%d) | %d | %d | %d |'%(x[1],x[2],x[0],x[3],x[4],x[5],x[6],x[7],x[8]))
