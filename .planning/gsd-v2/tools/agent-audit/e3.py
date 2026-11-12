from common import *
import datetime
S=rs('gsd-executor')
sh=[r for r in S if any(e[0]=='tu' and e[1]=='SubagentHandback' for e in P[r['path']])]
print('handback t0 min', datetime.datetime.fromtimestamp(min(r['t0'] for r in sh)), 'executors after that date', sum(1 for r in S if r['t0']>=min(r['t0'] for r in sh)))
tmin=min(r['t0'] for r in sh)
late=[r for r in S if r['t0']>=tmin]
print('late using handback',len(sh),'/',len(late))
# ending classification
def endcls(r):
    ev=P[r['path']]; lt=last_text(ev); a='\n'.join(e[1] for e in ev if e[0]=='text')
    hb=any(e[0]=='tu' and e[1]=='SubagentHandback' for e in ev)
    if r.get('ended_err'): return 'api-error end'
    if hb: return 'handback'
    if re.search(r'PLAN COMPLETE|PLAN INTERRUPTED|CHECKPOINT REACHED',lt): return 'std marker'
    if re.search(r'(?i)\b(next step|remaining|still need|not (yet )?(done|complete|finished)|blocked|stopping|paused|handoff|hand-off|continuation)\b',lt): return 'prose: unfinished/blocked'
    if len(lt)<40: return 'empty/tiny'
    return 'prose: other'
for name,sub in [('all',S),('late',late),('exec plan desc',[r for r in S if re.match(r'(?i)execute (plan )?\d',r['meta'].get('description') or '')])]:
    print(name,len(sub),collections.Counter(endcls(r) for r in sub).most_common())
ex=collections.defaultdict(list)
for r in S: 
    k=endcls(r)
    if len(ex[k])<4: ex[k].append(bn(r))
print(dict(ex))
for r in [r for r in S if endcls(r)=='prose: unfinished/blocked'][:8]: print(bn(r),r['meta'].get('description'),'|',last_text(P[r['path']])[:250].replace('\n',' '))
