from common import *
S=rs('gsd-planner')
cat=collections.Counter(); ex=collections.defaultdict(list)
for r in S:
    ev=P[r['path']]; lt=last_text(ev); a='\n'.join(e[1] for e in ev if e[0]=='text')
    hb=any(e[0]=='tu' and e[1]=='SubagentHandback' for e in ev)
    if r.get('ended_err'): k='api error'
    elif hb: k='handback'
    elif re.search(r'PLANNING COMPLETE|REVISION COMPLETE|GAP CLOSURE',lt): k='std marker'
    elif len(lt)<40: k='empty/tiny'
    elif re.search(r'(?i)verdict|approved|findings|round',lt[:200]): k='review-ish prose'
    else: k='prose'
    cat[k]+=1; ex[k].append(bn(r))
print(cat, {k:v[:2] for k,v in ex.items()})
# plans claiming all checked: validation steps executed? count transcripts with grep for 'deferral' check in Bash
chk=0
for r in S:
    if any(e[0]=='tu' and e[1]=='Bash' and re.search(r'tdd=\\?"true|deferr|e2e_flows|<task ',e[2]['cmd']) for e in P[r['path']]): chk+=1
print('planners running a mechanical mandate-check bash (tdd/deferral/e2e_flows/<task grep)',chk)
# zero-write planners: what are they (reviews?)
nw=[r for r in S if not any(e[0]=='tu' and e[1]=='Write' for e in P[r['path']])]
print('no Write at all',len(nw),[ (r['meta'].get('description'),) for r in nw[:6]])
