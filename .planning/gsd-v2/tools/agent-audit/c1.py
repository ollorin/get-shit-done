from common import *
S=rs('gsd-phase-coordinator'); N=len(S)
for r in S[:0]: pass
print(N, collections.Counter(r['meta'].get('model') for r in S), collections.Counter(r['meta'].get('spawnDepth') for r in S))
# bash classification
def bc(cmd):
    c=cmd
    if re.search(r'\bsleep\b|until |\bwait\b|for i in',c): return 'poll/sleep/until'
    if re.search(r'tail |ls -l?t|stat |cat .*\.output|\.log|tasks/',c) and not re.search(r'git commit',c): return 'poll/tail/ls log'
    if re.search(r'git (status|log|diff|show|rev-parse|branch|worktree|merge|cherry|add|commit)',c): return 'git'
    if re.search(r'deno (task )?test|run-integration|nx test|preflight|test-run',c): return 'test/preflight run'
    if re.search(r'gsd-tools',c): return 'gsd-tools'
    if re.search(r'python3|node ',c): return 'python/node script'
    if re.search(r'df -h|ps |pgrep|lsof|docker|supabase|orbctl|vm_stat|memory_pressure|sysctl',c): return 'host/stack probe'
    if re.search(r'^\s*(cat|sed|head|ls|wc|jq|zg)',c.strip()): return 'read-ish'
    return 'other'
tot=collections.Counter(); per=[]
for r in S:
    ev=P[r['path']]; c=collections.Counter()
    for e in ev:
        if e[0]=='tu':
            c['tu']+=1
            if e[1]=='Bash': c['bash:'+bc(e[2]['cmd'])]+=1
            else: c[e[1]]+=1
    tot+=c; per.append((r,c))
print('total tool uses',tot['tu']); 
for k,v in tot.most_common(16): print(f'  {k:28s}{v:6d} {100*v/tot["tu"]:5.1f}%')
# Bash code-ish: sed -i, redirect writes, Write tool
code=0; ex=[]
for r in S:
    for e in P[r['path']]:
        if e[0]=='tu' and e[1]=='Bash' and re.search(r"sed -i|cat\s*>|python3? .*open\(.*['\"]w|<<\s*'?EOF.*>|tee ",e[2]['cmd']) and not re.search(r'/\.tmp/|\.planning/',e[2]['cmd']): code+=1; ex.append(bn(r)) if len(ex)<3 else 0
print('bash file-writes outside .tmp/.planning',code,ex)
wp=collections.Counter()
for r in S:
    for e in P[r['path']]:
        if e[0]=='tu' and e[1]=='Write':
            p=e[2].get('p') or ''
            wp['.planning' if '/.planning/' in p else '.tmp' if '/.tmp/' in p else 'other:'+os.path.splitext(p)[1]]+=1
print('Write targets',wp.most_common(8))
