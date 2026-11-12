#!/usr/bin/env python3
import sys,re,json,collections,statistics,os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from mt_analyze import *
V=sys.argv[1] if len(sys.argv)>1 else 'mid'
leaf=[x for x in X if x['role']!='gsd-phase-coordinator']
coord=[x for x in X if x['role']=='gsd-phase-coordinator']
IV={id(x):attrib(x,V)[0] for x in X}
def minutes(x,iv):
    g=gaps(x); s=set()
    for a,b in iv:
        for m in range(int(a//60),int(b//60)+1):
            mm=m*60
            if not any(gs<=mm<ge for gs,ge in g): s.add(m)
    return s
# ---- wall grid
act={}; mut={}
for x in leaf:
    act[id(x)]=minutes(x,[[x['t0'],x['t1']]]); mut[id(x)]=minutes(x,IV[id(x)])&act[id(x)]
def grid(sel):
    A=collections.Counter(); M=collections.Counter()
    for x in sel:
        for m in act[id(x)]: A[m]+=1
        for m in mut[id(x)]: M[m]+=1
    busy=len(A); many=sum(1 for m in A if M.get(m,0)>0); monly=sum(1 for m in A if M.get(m,0)==A[m])
    return busy/60,many/60,monly/60
print('### wall-clock grid (minutes with >=1 leaf agent active, idle>30min removed), variant',V)
for ph in ('all','398','399','400','401','402'):
    sel=[x for x in leaf if ph=='all' or x['phase']==ph]
    b,a,o=grid(sel); print('%-4s busy %.0f h | any mutation active %.0f h (%.0f%%) | mutation is the ONLY active work %.0f h (%.0f%%)'%(ph,b,a,100*a/b,o,100*o/b))
# ---- coordinator allocation
tot_c_h=tot_c_usd=mc_h=mc_usd=0
ph_act=collections.defaultdict(collections.Counter); ph_mut=collections.defaultdict(collections.Counter)
for x in leaf:
    for m in act[id(x)]: ph_act[x['phase']][m]+=1
    for m in mut[id(x)]: ph_mut[x['phase']][m]+=1
for c in coord:
    ms=minutes(c,[[c['t0'],c['t1']]]); ph=c['phase']
    sh={m:(ph_mut[ph].get(m,0)/ph_act[ph][m] if ph_act[ph].get(m) else 0) for m in ms}
    tot_c_h+=len(ms)/60; mc_h+=sum(sh.values())/60
    cu=0;cm=0
    for t in c['turns']:
        m=int(t[0]//60); u=cost(t,c['model']); cu+=u; cm+=u*sh.get(m,0)
    tot_c_usd+=cu; mc_usd+=cm
print('### coordinators (n=%d): active h %.0f, allocated to mutation by concurrent-leaf share %.1f h (%.0f%%); $ %.0f, mutation-allocated $%.0f (%.0f%%)'%(len(coord),tot_c_h,mc_h,100*mc_h/tot_c_h,tot_c_usd,mc_usd,100*mc_usd/tot_c_usd))
LH=sum(total(x)[0] for x in leaf)/3600; LU=sum(total(x)[1] for x in leaf)
MH=sum(attrib(x,V)[1] for x in leaf)/3600; MU=sum(attrib(x,V)[2] for x in leaf)
print('### leaf+coordinator combined: hours %.1f%% , $ %.1f%%'%(100*(MH+mc_h)/(LH+tot_c_h),100*(MU+mc_usd)/(LU+tot_c_usd)),' (leaf mut %.1f/%.1f h, $%.0f/%.0f)'%(MH,LH,MU,LU))
# ---- component breakdown inside attributed intervals
COMP={'test-unit-file':'unit test file run','test-live-file':'live integration file run','test-bucket':'integration bucket run','test-suite':'full suite run','db-reset':'supabase db reset','stack-db':'stack/psql/serve ops','wait':'wait/poll shell loops',
 'edit-prod':'edit prod/migration (mutant apply/restore)','edit-test':'edit test','edit-tmp':'edit .tmp (mutant files, logs)','edit-plan':'edit evidence/.planning docs','git':'git','gates':'lint/check/gates','search':'search','read':'read','bash-other':'other bash'}
tot=collections.Counter(); resid=0.0; alltot=0.0
for x in leaf:
    iv=IV[id(x)]
    if not iv: continue
    g=gaps(x)
    L=sum(b-a-ov(a,b,g) for a,b in iv); alltot+=L; used=0.0
    for c in x['calls']:
        d=min(c[1],1800)
        if c[1]<0: continue
        o=ov(c[0],c[0]+d,iv)
        if o>0:
            k=COMP.get(c[2],'other tool'); tot[k]+=o; used+=o
    resid+=max(0,L-used)
print('### where the attributed mutation time goes (sum of call time inside attributed intervals; residual = model generation + harness)')
for k,v in tot.most_common(): print('  %-44s %6.1f h %5.1f%%'%(k,v/3600,100*v/alltot))
print('  %-44s %6.1f h %5.1f%%'%('model generation + harness (residual)',resid/3600,100*resid/alltot))
# parallel overlap warning
print('  total attributed %.1f h'%(alltot/3600))
# ---- stack time
ST={'db-reset','stack-db','test-bucket','test-live-file','test-suite'}
st_all=sum(c[1] for x in leaf for c in x['calls'] if c[2] in ST and 0<=c[1]<7200)
st_mut=sum(ov(c[0],c[0]+min(c[1],7200),IV[id(x)]) for x in leaf for c in x['calls'] if c[2] in ST and c[1]>0)
print('### stack-occupying call time (reset, psql/serve, live file, bucket, suite): all scoped leaf %.1f h, inside mutation intervals %.1f h (%.0f%%)'%(st_all/3600,st_mut/3600,100*st_mut/st_all))
# ---- by role class of re-proof plans
print('### evidence/re-proof plans (400-46/47/50/51), all agents'); 
for p in sorted(EVID_PLANS):
    S=[x for x in leaf if x['plan']==p]
    print('  %s spawns %d active h %.1f $%.0f'%(p,len(S),sum(total(x)[0] for x in S)/3600,sum(total(x)[1] for x in S)))
