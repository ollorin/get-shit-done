import sys,re; sys.path.insert(0,'.')
from lib import *
R=load()
C=[r for r in R if r['proj'].endswith('charlotte')]
def stat(r):
    t=r.get('last_text') or ''
    m=re.search(r'"status":\s*"(\w+)"',t)
    # overall status is first occurrence after "test"
    m0=re.search(r'"test":\s*"([^"]+)"\s*,\s*"status":\s*"(\w+)"',t)
    return (m0.group(1),m0.group(2)) if m0 else (None,None)
st=collections.Counter(stat(r)[1] for r in C); print('status',st)
w=[wall(r)/60 for r in C]; print('runs',len(C),'wall min: mean %.1f med %.1f p90 %.1f max %.1f total h %.1f'%(statistics.mean(w),statistics.median(w),pct(w,90),max(w),sum(w)/60))
print('msgs med %d p90 %d; tokens(all kinds) med %.2fM p90 %.2fM; total %.0fM; est$ total %.0f'%(statistics.median([r['n_msgs'] for r in C]),pct([r['n_msgs'] for r in C],90),statistics.median([sum(tokens(r)[:4]) for r in C])/1e6,pct([sum(tokens(r)[:4]) for r in C],90)/1e6,sum(sum(tokens(r)[:4]) for r in C)/1e6,sum(tokens(r)[4] for r in C)))
mc=[sum(v for k,v in r['tool_counts'].items() if k.startswith('mcp__charlotte')) for r in C]
print('charlotte tool calls/run med %d p90 %d max %d total %d'%(statistics.median(mc),pct(mc,90),max(mc),sum(mc)))
tt=sum(r['tool_time'] for r in C); ww=sum(wall(r) for r in C)
print('tool-wait share of wall %.1f%%; model-gen share %.1f%%'%(100*tt/ww,100*(1-tt/ww)))
# by tool: calls, total result chars, avg chars, dur
T=collections.defaultdict(lambda:[0,0,0.0])
for r in C:
    for k,v in r['tool_res_chars'].items(): T[k][0]+=v[0]; T[k][1]+=v[1]
    for k,v in r['cat'].items():
        pass
print('| tool | calls | avg result chars | total result Mchars |')
for k,v in sorted(T.items(),key=lambda x:-x[1][1])[:10]: print('| %s | %d | %d | %.1f |'%(k.replace('mcp__charlotte__charlotte_',''),v[0],v[1]/v[0],v[1]/1e6))
totchars=sum(v[1] for v in T.values()); print('total tool-result chars',totchars/1e6,'M; screenshot share %.1f%%, wait_for share %.1f%%, observe %.1f%%'%(100*T['mcp__charlotte__charlotte_screenshot'][1]/totchars,100*T['mcp__charlotte__charlotte_wait_for'][1]/totchars,100*T['mcp__charlotte__charlotte_observe'][1]/totchars))
# per-call mean durations for charlotte tool categories: cat dur
D=[0,0.0]
for r in C:
    v=r['cat'].get('mcp:charlotte'); 
    if v: D[0]+=v[0]; D[1]+=v[1]
print('charlotte tool calls',D[0],'total tool s',round(D[1]),'mean s %.2f'%(D[1]/D[0]))
# context growth
mx=[r['max_ctx'] for r in C]; print('max ctx per run med %d p90 %d'%(statistics.median(mx),pct(mx,90)))
# startup ctx
ft=[sum(r['first_turn'][1:4]) for r in C if r['first_turn']]; print('first-turn ctx med',statistics.median(ft))
# turns per tool call; cache read share
cr=sum(tokens(r)[2] for r in C); allt=sum(sum(tokens(r)[:4]) for r in C); print('cache read share %.1f%%'%(100*cr/allt))
# by day
d=collections.defaultdict(lambda:[0,0.0])
for r in C: x=d[day(r['t0'])]; x[0]+=1; x[1]+=wall(r)/60
print(sorted((k,v[0],round(v[1])) for k,v in d.items()))
# repeats of same scenario
names=collections.Counter(stat(r)[0] for r in C if stat(r)[0]); print('distinct scenarios',len(names),'runs w name',sum(names.values()),'most repeated',names.most_common(5))
fl=[stat(r) for r in C if stat(r)[1] and stat(r)[1]!='PASS']; print('non-pass sample',fl[:5])
# gsd-charlotte-qa agents + gp charlotte
Q=[r for r in R if role(r)=='gsd-charlotte-qa']
print('gsd-charlotte-qa agents',len(Q),'wall min med %.1f p90 %.1f total h %.1f; msgs med %d; tokens med %.2fM; est$ %.0f'%(statistics.median([wall(r)/60 for r in Q]),pct([wall(r)/60 for r in Q],90),sum(wall(r) for r in Q)/3600,statistics.median([r['n_msgs'] for r in Q]),statistics.median([sum(tokens(r)[:4]) for r in Q])/1e6,sum(tokens(r)[4] for r in Q)))
mq=[sum(v for k,v in r['tool_counts'].items() if k.startswith('mcp__charlotte')) for r in Q]; print(' charlotte calls/agent med',statistics.median(mq),'total',sum(mq))
G=[r for r in R if role(r)=='general-purpose' and re.search(r'charlotte',(r['meta'].get('description') or ''),re.I)]
print('GP agents w/ Charlotte in description',len(G),'h %.1f est$ %.0f'%(sum(wall(r) for r in G)/3600,sum(tokens(r)[4] for r in G)))
# deno-runner (new API runner) Bash usage: bash:charlotte
bc=collections.defaultdict(lambda:[0,0.0])
for r in R:
    for k,v in r['cat'].items():
        if k in('bash:charlotte','mcp:charlotte'): bc[k][0]+=v[0]; bc[k][1]+=v[1]
print(dict(bc))
