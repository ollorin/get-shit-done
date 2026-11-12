from common import *
import sys
for role in ['gsd-executor','gsd-phase-coordinator','gsd-planner']:
    S=rs(role); c=collections.Counter(); ex={}; n=0; tr=0
    for r in S:
        for e in P[r['path']]:
            if e[0]=='tr':
                tr+=1
                s=e[3]
                if e[5] or re.search(r'(?i)permission|was denied|hook.*block|blocked by|requires approval|not allowed',s):
                    k=None
                    if re.search(r'(?i)hook',s): k='hook block'
                    elif re.search(r'(?i)permission|denied|approval|not allowed',s): k='permission/denied'
                    elif e[5]: k='is_error other'
                    if k:
                        c[k]+=1; ex.setdefault(k,(bn(r),s[:160].replace('\n',' ')))
    print(role,'tool results',tr,dict(c)); 
    for k,v in ex.items(): print('   ',k,v)
