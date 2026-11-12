from common import *
S=rs('gsd-executor'); N=len(S)
def txt(ev): return '\n'.join(e[1] for e in ev if e[0]=='text')
c=collections.Counter(); ex=collections.defaultdict(list)
def mark(k,r):
    c[k]+=1
    if len(ex[k])<3: ex[k].append(bn(r))
for r in S:
    ev=P[r['path']]; lt=last_text(ev); alltxt=txt(ev)
    tus=[e for e in ev if e[0]=='tu']
    names=collections.Counter(e[1] for e in tus)
    if 'PLAN COMPLETE' in lt: mark('end:PLAN COMPLETE in last text',r)
    elif 'PLAN COMPLETE' in alltxt: mark('end:PLAN COMPLETE earlier, not last',r)
    if 'PLAN INTERRUPTED' in alltxt: mark('PLAN INTERRUPTED anywhere',r)
    if 'CHECKPOINT REACHED' in alltxt: mark('CHECKPOINT REACHED anywhere',r)
    if names['SubagentHandback']: mark('uses SubagentHandback',r)
    if '"status"' in alltxt and ('"complete"' in alltxt or '"interrupted"' in alltxt or '"blocked"' in alltxt): mark('JSON status trailer in text',r)
    if 'Telemetry' in alltxt and 'context_pressure' in alltxt: mark('Telemetry line',r)
    if r.get('ended_err'): mark('ended_err',r)
    if not any(k in alltxt for k in('PLAN COMPLETE','PLAN INTERRUPTED','CHECKPOINT REACHED')) and not names['SubagentHandback']: mark('NO terminal marker/handback',r)
    # writes
    wr=[e for e in tus if e[1]=='Write']
    if any('SUMMARY.md' in (e[2].get('p') or '') for e in wr): mark('wrote *SUMMARY.md',r)
    if any('EXECUTOR-HANDOFF' in (e[2].get('p') or '') or 'EXECUTOR-HANDOFF' in (e[2].get('cmd') or '') for e in tus): mark('EXECUTOR-HANDOFF.json touched',r)
    if any('TASK-CHECKPOINT' in (e[2].get('p') or '')+(e[2].get('cmd') or '') for e in tus): mark('TASK-CHECKPOINT touched',r)
    if any('deferred-items' in (e[2].get('p') or '')+(e[2].get('cmd') or '') for e in tus): mark('deferred-items.md touched',r)
    sm=[e for e in tus if e[1]=='SendMessage']
    if sm: mark('SendMessage any',r)
    for e in sm:
        to=e[2]['to']; c['SM to:'+('main' if to=='main' else 'other')]+=1
        if 'continuation' in e[2]['msg'].lower() or 'continuation' in e[2]['msg'].lower(): c['SM continuation']+=1
        if re.search(r'heartbeat|task \d+/\d+',e[2]['msg'],re.I): c['SM heartbeat-like']+=1
    if names['Monitor']: mark('Monitor',r)
    # file-ref reads
    for ref in ['executor-detail','content-firewall','agent-messaging','coordinator-detail','checkpoints','resilience']:
        if any(ref in ((e[2].get('p') or '')+(e[2].get('cmd') or '')) for e in tus if e[1] in('Read','Bash')): mark('reads '+ref,r)
    if '<wave_peers>' in (r.get('first_prompt') or ''): mark('prompt has wave_peers',r)
    if '<handoff_brief>' in (r.get('first_prompt') or ''): mark('prompt has handoff_brief',r)
    if re.search(r'Rule 4',alltxt): mark('mentions Rule 4',r)
    if re.search(r'Auto-approved|Auto-selected',alltxt): mark('auto-approve log',r)
    if 'Self-Check' in alltxt or any('Self-Check' in str(e[2]) for e in wr): mark('Self-Check',r)
    if any('Defect Classes' in str(e[2]) for e in tus) or 'Defect Classes' in alltxt: mark('Defect Classes mentioned',r)
print(N)
for k,v in sorted(c.items()): print(f'{k:45s} {v:5d} {100*v/N:5.1f}%  {ex.get(k,[])[:2]}')
