#!/usr/bin/env python3
"""Experiment 05: end-to-end mutation attribution for phases 398-402 from out/mt_calls.jsonl. Variants: low / mid / high."""
import sys,re,json,collections,statistics,os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from lib import *
X=[json.loads(l) for l in open(os.path.join(out_dir(),'mt_calls.jsonl'))]
DESC=re.compile(r'mutant|mutation|\bmuts?\b|kill-proof',re.I)
EVID_PLANS={'400-46','400-47','400-50','400-51'}
EXEC={'db-reset','test-bucket','test-suite','test-live-file','test-unit-file','stack-db','wait','bash-other','edit-tmp','edit-prod','edit-test'}
HARD={'db-reset','test-bucket','test-suite','test-live-file','test-unit-file','stack-db','wait','edit-prod','edit-test'}
EVC={'edit-plan','git','read','search','gates','bash-other','edit-tmp'}
VAR={ 'low':dict(thr=2,gap=120,ext=0,evid=False,weak=False),
      'mid':dict(thr=2,gap=300,ext=120,evid=True,weak=False),
      'high':dict(thr=2,gap=900,ext=300,evid=True,weak=True)}
EXTC={'db-reset','stack-db','test-bucket','test-live-file','test-unit-file','edit-prod','edit-test','edit-tmp'}
def cost(t,m):
    return PRICE.get(m,0.43)*(t[1]+1.25*t[2]+0.1*t[3]+5*t[4])/1e6
def merge(iv):
    iv=sorted([list(i) for i in iv]); o=[]
    for a,b in iv:
        if o and a<=o[-1][1]: o[-1][1]=max(o[-1][1],b)
        else: o.append([a,b])
    return o
def windows(x,v):
    cfg=VAR[v]; C=sorted(x['calls']); out=[]
    S=[c for c in C if c[3]>=cfg['thr'] and c[2] in EXEC]
    if S:
        cl=[[S[0][0],S[0][0]+S[0][1],[S[0]]]]
        for c in S[1:]:
            if c[0]-cl[-1][1]<=cfg['gap']: cl[-1][1]=max(cl[-1][1],c[0]+c[1]); cl[-1][2].append(c)
            else: cl.append([c[0],c[0]+c[1],[c]])
        keep=[]
        for a0,b0,mem in cl:
            if any(m[2] in HARD for m in mem): keep.append([a0,b0])
            elif cfg['evid']:
                for m in mem: out.append([max(x['t0'],m[0]-120),m[0]+m[1]])
        cl=keep
        if cfg['ext']:
            orig=[tuple(w) for w in cl]
            for w,(a0,b0) in zip(cl,orig):
                for c in C:
                    if c[2] in EXTC and ((b0<=c[0]<=b0+cfg['ext']) or (a0-cfg['ext']<=c[0]+c[1]<=a0)):
                        w[0]=min(w[0],c[0]); w[1]=max(w[1],c[0]+c[1])
        out+=cl
    if cfg['evid']:
        prev_end=x['t0']
        for c in C:
            hit=(c[3]>=2 and c[2] in EVC) or (cfg['weak'] and c[3]>=1 and c[2] not in('spawn',))
            if hit: out.append([max(prev_end,c[0]-120),c[0]+c[1]])
            prev_end=max(prev_end,c[0]+c[1])
    return merge(out)
def gaps(x): return [(a,a+d) for a,d in x['idle_gaps']]
def ov(a,b,iv):
    return sum(max(0,min(b,y)-max(a,x)) for x,y in iv)
def mode(x):
    if x['role']=='gsd-phase-coordinator': return 'coord'
    if DESC.search(x['desc'] or ''): return 'desc'
    if x['plan'] in EVID_PLANS: return 'evid'
    return 'win'
def kind(x):
    d=(x['desc'] or '').lower(); r=x['role']
    if r=='gsd-executor': return 'executor'
    if r=='gsd-phase-coordinator': return 'coordinator'
    if re.search(r'ruling|opus (batch|step)|escalat|adjudic',d): return 'ruling'
    if re.search(r'review|verif|re-check|audit|round',d) or r in('gsd-verifier','gsd-plan-checker'): return 'review'
    if r=='gsd-planner': return 'plan'
    if r in('gsd-debugger','gsd-test-writer'): return 'debug/test-writer'
    return 'gp-runner/impl'
def attrib(x,v):
    """-> (intervals, active_s, usd) attributed to mutation for spawn x under variant v"""
    m=mode(x)
    if m=='coord': return [],0,0
    if m in('desc','evid'): iv=[[x['t0'],x['t1']]]
    else: iv=windows(x,v)
    g=gaps(x)
    act=sum(b-a-ov(a,b,g) for a,b in iv)
    usd=sum(cost(t,x['model']) for t in x['turns'] if any(a<=t[0]<=b for a,b in iv))
    return iv,act,usd
def total(x):
    g=gaps(x); a=(x['t1']-x['t0'])-ov(x['t0'],x['t1'],g)
    return a,sum(cost(t,x['model']) for t in x['turns'])
# ------------ per-variant roll-up
res={}
for v in VAR:
    R=collections.defaultdict(lambda:[0,0.0,0.0,0.0,0.0])  # n, mut act, mut usd, tot act, tot usd by (phase,kind,mode)
    for x in X:
        iv,a,u=attrib(x,v); ta,tu=total(x)
        k=(x['phase'],kind(x),mode(x))
        r=R[k]; r[0]+=1; r[1]+=a; r[2]+=u; r[3]+=ta; r[4]+=tu
    res[v]=R
def roll(R,keyf,filt=lambda k:True):
    o=collections.defaultdict(lambda:[0,0.0,0.0,0.0,0.0])
    for k,r in R.items():
        if not filt(k): continue
        q=o[keyf(k)]
        for i in range(5): q[i]+=r[i]
    return o
if __name__=='__main__':
    leafF=lambda k:k[1]!='coordinator'
    print('=== scope: spawns %d'%len(X))
    for v in VAR:
        t=roll(res[v],lambda k:'all',leafF)['all']; c=roll(res[v],lambda k:'all',lambda k:k[1]=='coordinator')['all']
        print('%-5s leaf: spawns %d  mutation active h %.1f of %.1f (%.1f%%)  mutation $ %.0f of %.0f (%.1f%%)   | coordinators n=%d active h %.1f $%.0f'%(v,t[0],t[1]/3600,t[3]/3600,100*t[1]/t[3],t[2],t[4],100*t[2]/t[4],c[0],c[3]/3600,c[4]))
    print()
    print('--- by phase (mid)')
    P=roll(res['mid'],lambda k:k[0],leafF)
    for p,r in sorted(P.items()): print(p,'spawns %d mut h %.1f / %.1f (%.1f%%)  $ %.0f / %.0f (%.1f%%)'%(r[0],r[1]/3600,r[3]/3600,100*r[1]/r[3],r[2],r[4],100*r[2]/r[4]))
    print('--- by kind (mid)')
    K=roll(res['mid'],lambda k:k[1],leafF)
    for p,r in sorted(K.items(),key=lambda kv:-kv[1][1]): print('%-18s spawns %d mut h %.1f / %.1f (%.1f%%)  $ %.0f / %.0f (%.1f%%)'%(p,r[0],r[1]/3600,r[3]/3600,100*r[1]/r[3],r[2],r[4],100*r[2]/r[4]))
    print('--- by mode (mid)')
    M=roll(res['mid'],lambda k:k[2],leafF)
    for p,r in sorted(M.items(),key=lambda kv:-kv[1][1]): print('%-6s spawns %d mut h %.1f / %.1f  $ %.0f / %.0f'%(p,r[0],r[1]/3600,r[3]/3600,r[2],r[4]))
