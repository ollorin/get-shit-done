from common import *
import sys, statistics as st
role=sys.argv[1]; S=rs(role)
def nc(r): return sum(1 for e in P[r['path']] if e[0]=='compact')//2
def tokcost(r):
    return sum(sum(v[:5]) if isinstance(v,list) else 0 for v in (r['tok'] or {}).values())
print('top compacted:')
for r in sorted(S,key=nc,reverse=True)[:4]: print(bn(r),nc(r),r['meta'].get('description'),r['meta'].get('model'),r['max_ctx'],round((r['t1']-r['t0'])/60),'min', len(P[r['path']]))
print('ended_err:')
for r in [r for r in S if r.get('ended_err')][:6]: print(bn(r),nc(r),r['meta'].get('description'),r['meta'].get('model'),r['max_ctx'],round((r['t1']-r['t0'])/60),'min',(r.get('last_text') or '')[:80])
med=sorted(S,key=lambda r:r['max_ctx'] or 0)[len(S)//2-1:len(S)//2+2]
print('median:')
for r in med: print(bn(r),nc(r),r['meta'].get('description'),r['meta'].get('model'),r['max_ctx'],round((r['t1']-r['t0'])/60),'min')
