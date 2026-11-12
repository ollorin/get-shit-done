from common import *
S=rs('gsd-phase-coordinator')
for r in S: print(bn(r)[:14],r['meta'].get('model'),r['meta'].get('spawnDepth'),round((r['t1']-r['t0'])/3600,1),'h',len(P[r['path']]),'ev', (r['meta'].get('description') or '')[:50],'|',(last_text(P[r['path']]) or '')[:70].replace('\n',' '))
