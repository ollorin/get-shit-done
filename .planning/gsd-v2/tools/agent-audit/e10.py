from common import *
S=rs('gsd-executor')
sm=[r for r in S if any(e[0]=='tu' and e[1]=='Write' and (e[2].get('p') or '').endswith('-SUMMARY.md') for e in P[r['path']])]
nod=[r for r in sm if not any(e[0]=='tu' and e[1] in('Agent','Task') and e[2]['st']=='gsd-docs-updater' for e in P[r['path']])]
c=collections.Counter()
for r in nod:
    fp=(r.get('first_prompt') or '')
    if re.search(r'(?i)docs?[- ](updater|agent)',fp): c['prompt mentions docs updater/agent']+=1
    if re.search(r'(?i)(no|skip|not|without)[^.\n]{0,40}docs?[- ]?(updater|update|agent)|docs?[- ]updater[^.\n]{0,40}(skip|coordinator|not)',fp): c['prompt says skip/coordinator does docs']+=1
    if re.search(r'(?i)docs',fp): c['prompt mentions docs']+=1
print(len(nod),c)
# self-check
def allstr(r): return ' '.join(str(e[2]) for e in P[r['path']] if e[0]=='tu')
print('selfcheck in SUMMARY writers', sum('Self-Check' in allstr(r) for r in sm))
# first-prompt contents: do they restate hard rules? lengths
import statistics as st
print('first_prompt len median', st.median(len(r.get('first_prompt') or '') for r in S))
print('prompt mentions executor-detail', sum('executor-detail' in (r.get('first_prompt') or '') for r in S))
