from common import *
import sys
for role in ['gsd-executor','gsd-phase-coordinator','gsd-planner']:
    S=rs(role); c=collections.Counter(); exm={}
    for r in S:
        for e in P[r['path']]:
            if e[0]=='tr' and e[5]:
                s=e[3]
                m=re.search(r'No such tool available: (\w+)',s)
                if m: k='no such tool: '+m.group(1)
                elif s.startswith('<tool_use_error>Blocked: sleep'): k='blocked sleep'
                elif 'exceeds maximum allowed size' in s: k='Read too large (unbounded)'
                elif 'Found' in s[:40] and 'matches of the string to replace' in s: k='Edit multi-match'
                elif 'File has been modified since read' in s: k='Edit stale read'
                elif 'File does not exist' in s: k='Read nonexistent'
                else: continue
                c[k]+=1; exm.setdefault(k,bn(r))
    print(role,[(k,v,exm[k]) for k,v in c.most_common()])
