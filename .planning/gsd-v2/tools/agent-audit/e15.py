from common import *
r=[r for r in R if bn(r)=='agent-ad98b393fccb6791e.jsonl'][0]
ev=P[r['path']]
n=0
for i,e in enumerate(ev):
    if e[0]=='tr' and e[5] and 'Blocked: sleep' in e[3]:
        print(i,e[3][:300]); 
        # preceding tu
        for j in range(i-1,max(0,i-3),-1):
            if ev[j][0]=='tu': print('   cmd:',ev[j][2].get('cmd','')[:200]); break
        n+=1
        if n>=2: break
# retry pattern: after blocked, how many blocked in a row
S=rs('gsd-executor'); tot=0; seqs=[]
for r in S:
    ev=P[r['path']]; run=0
    for e in ev:
        if e[0]=='tr' and e[5] and 'Blocked: sleep' in e[3]: run+=1
        elif e[0]=='tr': 
            if run: seqs.append(run); run=0
print('transcripts with blocked sleep',sum(1 for r in S if any(e[0]=='tr' and e[5] and 'Blocked: sleep' in e[3] for e in P[r['path']])),'max run',max(seqs))
