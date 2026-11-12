from common import *
import json
S=rs('gsd-phase-coordinator')
cat=collections.Counter(); ex=collections.defaultdict(list)
for r in S:
    lt=last_text(P[r['path']]); 
    if r.get('ended_err'): k='ended on API error/limit'
    elif re.search(r'(?i)stale|notification|wait (loop|shell)|draining',lt[:300]): k='stale wait-shell notification (post-handback wake)'
    elif re.search(r'"phase"\s*:|"steps_completed"',lt): k='return_state JSON'
    elif re.search(r'(?i)not complete|not done|handing back|paused|stopp(ed|ing)|blocked|gaps_found|incomplete|did not pass',lt[:400]): k='handback: incomplete/blocked/paused'
    elif re.search(r'(?i)complete|passed|closed|verified|ready for train|done',lt[:300]): k='handback: complete'
    elif len(lt)<60: k='mid-flow narration/tiny (killed or woke)'
    else: k='other'
    cat[k]+=1; ex[k].append(bn(r))
for k,v in cat.most_common(): print(v,k,ex[k][:2])
# background waits
bgw=0; tr_n=0; polls=0
for r in S:
    for l in open(r['path']):
        if '"run_in_background"' not in l: continue
        try: d=json.loads(l)
        except: continue
        m=d.get('message'); 
        if not isinstance(m,dict) or not isinstance(m.get('content'),list): continue
        for b in m['content']:
            if b.get('type')=='tool_use' and b['name']=='Bash' and b['input'].get('run_in_background'):
                bgw+=1
                if re.search(r'sleep|until',b['input'].get('command','')): polls+=1
print('bash run_in_background',bgw,'of which sleep/until loops',polls)
# ListAgents? tool names in coordinators
print(collections.Counter(k for r in S for k in r['tool_counts']).most_common(20))
