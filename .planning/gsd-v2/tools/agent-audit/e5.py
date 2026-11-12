from common import *
import sys
role=sys.argv[1]; TH=int(sys.argv[2]) if len(sys.argv)>2 else 20000
S=rs(role); N=len(S)
def cmdclass(cmd):
    c=cmd.strip()
    pats=[('deno test/task test',r'deno (task )?test|nx test|test:ci'),('integration/run-integration',r'run-integration|integration'),('git diff/show/log',r'git (diff|show|log)'),('cat/sed/head file',r'^(cat|sed|head|tail|awk)\b|\bcat\b'),('preflight',r'preflight'),('deno check/lint/fmt',r'deno (check|lint|fmt)'),('zg query',r'zg '),('gsd-tools',r'gsd-tools'),('supabase/psql/docker',r'supabase|psql|docker'),('python/node script',r'python3?|node |deno run'),('git status/commit',r'git (status|add|commit)'),('sleep/until/wait',r'sleep|until|wait')]
    for k,rx in pats:
        if re.search(rx,c): return k
    return 'other-bash'
big=collections.Counter(); bigchars=collections.Counter(); tot=collections.Counter(); ex=collections.defaultdict(list)
per=collections.Counter()
for r in S:
    ev=P[r['path']]; last_cmd=None; n=0
    for e in ev:
        if e[0]=='tu': last_cmd=(e[1],e[2])
        if e[0]=='tr':
            tot[e[1]]+=e[2]
            if e[2]>=TH:
                n+=1
                k=e[1]
                if k=='Bash' and last_cmd: k='Bash:'+cmdclass(last_cmd[1].get('cmd',''))
                big[k]+=1; bigchars[k]+=e[2]
                if len(ex[k])<2: ex[k].append(bn(r))
    per[r['path']]=n
print(role,N,'transcripts; results>=%d chars:'%TH,sum(big.values()),'in',sum(1 for v in per.values() if v),'transcripts')
print('total result chars by tool',{k:round(v/1e6,1) for k,v in tot.most_common(6)},'MB')
for k,v in big.most_common(12): print(f'{k:35s} n={v:5d} chars={bigchars[k]/1e6:6.1f}M avg={bigchars[k]//v:6d} {ex[k]}')
# compare compaction vs big results
comp=[(sum(1 for e in P[r['path']] if e[0]=='compact')//2, per[r['path']]) for r in S]
import statistics as st
print('compacted transcripts',sum(1 for c,_ in comp if c),'mean bigresults compacted',st.mean([b for c,b in comp if c] or [0]),'uncompacted',st.mean([b for c,b in comp if not c] or [0]))
# re-reads
rr=collections.Counter(); rrex={}
for r in S:
    cnt=collections.Counter()
    for e in P[r['path']]:
        if e[0]=='tu' and e[1]=='Read' and e[2].get('p'): cnt[(e[2]['p'],e[2].get('off'),e[2].get('lim'))]+=1
    for (p,o,l),v in cnt.items():
        if v>=3: rr[p.replace('<project-root>/','')]+=v-1; rrex.setdefault(p.replace('<project-root>/',''),bn(r))
print('top re-read (>=3 identical Read) files:',[(k,v,rrex[k]) for k,v in rr.most_common(6)], 'total extra',sum(rr.values()))
