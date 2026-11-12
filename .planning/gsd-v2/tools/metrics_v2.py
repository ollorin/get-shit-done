#!/usr/bin/env python3
"""GSD v2 KPI table (experiment 04). Usage:
  python3 metrics_v2.py [--no-refresh] [--workers N] [--no-git] [--json | --row | --selftest]
  GSD_SINCE=2026-10-31T21:00:00Z GSD_UNTIL=... python3 metrics_v2.py
Reads <GSD_OUT>/files.jsonl (+extras.jsonl), refreshed incrementally from ~/.claude/projects first.
Window = spawns whose first timestamp t0 is in [GSD_SINCE, GSD_UNTIL). Read-only on transcripts and the repo.
"""
import sys,os,re,json,subprocess,statistics,collections
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib

REPO=os.environ.get('GSD_REPO','<project-root>')

# ---------- helpers (copied logic from 13_q4 / 14_q4b / 15_q6 / 19_q3b / 08_fail) ----------
PID=re.compile(r'\b(\d{3}(?:\.\d)?)-(\d{2}[a-z]?)\b')
ZERO=re.compile(r'zero[ -]findings|\b0 findings|no findings|findings:\s*0\b|zero[ -]finding|\*\*zero|^zero|no blocker|nothing to fix|no (high|medium|med) (or|,)',re.I)
RESUME=re.compile(r'resume|death|re-dispatch|redispatch|continue|retry|handoff|hand-off|restart|relaunch|take over|takeover|from checkpoint',re.I)
def plan_of(r):
    d=r['meta'].get('description') or ''
    m=PID.search(d)
    if m: return m.group(1)+'-'+m.group(2)
    m2=PID.search((r.get('first_prompt') or '')[:600])
    return (m2.group(1)+'-'+m2.group(2)) if m2 else None
def zero(r): return bool(ZERO.search((r.get('last_text') or '')[:420]))
def med(a): return statistics.median(a) if a else 0
def catsum(rows,pred,idx):
    return sum(v[idx] for r in rows for k,v in r['cat'].items() if pred(k))
def is_wait(k): return k.startswith('bash:wait')
def is_test(k): return k in('bash:test','bash:integration-test')

def git_numstat(lo,hi):
    cmd=['git','-C',REPO,'log','--all','--no-merges','--format=@@%H\t%s','--numstat']
    if lo is not None: cmd.append('--since=%d'%lo)
    if hi is not None: cmd.append('--until=%d'%hi)
    out=subprocess.run(cmd,capture_output=True,text=True).stdout
    commits=[];cur=None
    for line in out.split('\n'):
        if line.startswith('@@'):
            if cur: commits.append(cur)
            cur={'s':line.split('\t',1)[1] if '\t' in line else '','f':[]}
        elif line.strip() and cur is not None:
            p=line.split('\t')
            if len(p)==3:
                a=int(p[0]) if p[0].isdigit() else 0; d=int(p[1]) if p[1].isdigit() else 0
                cur['f'].append((p[2],a+d))
    if cur: commits.append(cur)
    return commits
def area(f):
    if f.startswith('.planning/') or '/.planning/' in f: return 'planning-docs'
    if f.startswith('docs/') or f.endswith('.md'): return 'docs'
    if re.search(r'\.test\.|__tests__|/tests?/|e2e-charlotte|\.spec\.',f): return 'tests'
    if 'migrations/' in f: return 'migrations'
    if f.startswith('scripts/') or f.startswith('.claude/') or f.startswith('.github/'): return 'scripts/ci/rules'
    return 'src'

def load_extras():
    p=os.path.join(out_dir(),'extras.jsonl'); E={}
    if os.path.exists(p):
        for l in open(p):
            r=json.loads(l); E[r['path']]=r
    return E

# ---------- compute ----------
def compute(R,E,lo,hi,with_git=True):
    K={}
    leaf=[r for r in R if r['kind']=='sub']
    K['spawns']=len(leaf); K['transcripts']=len(R)
    tot=[sum(tokens(r)[i] for r in R) for i in range(5)]
    K['tok_fresh_M'],K['tok_cw_M'],K['tok_cr_M'],K['tok_out_M']=[t/1e6 for t in tot[:4]]; K['est_usd']=tot[4]
    # per role x model
    G=collections.defaultdict(list)
    for r in R: G[(role(r),rtier(r))].append(r)
    rm=[]
    for (ro,mo),L in G.items():
        usd=sum(tokens(r)[4] for r in L)
        if len(L)<3 and usd<5: continue
        rm.append({'role':ro,'model':mo,'spawns':len(L),'active_h':sum(r['active'] for r in L)/3600,'usd':usd,'usd_per_spawn':usd/len(L),
                   'first_turn_tok_med':med([sum(r['first_turn'][1:4]) for r in L if r['first_turn'] and sum(r['first_turn'][1:4])>10000])})
    rm.sort(key=lambda x:-x['usd']); K['role_model']=rm
    # coordinators
    C=[r for r in R if role(r)=='gsd-phase-coordinator']
    cw=sum(tokens(r)[1] for r in C); cr=sum(tokens(r)[2] for r in C)
    K['coord_spawns']=len(C); K['coord_active_h']=sum(r['active'] for r in C)/3600
    K['coord_cw_M']=cw/1e6; K['coord_cr_M']=cr/1e6; K['coord_cw_over_cr']=cw/cr if cr else 0
    K['coord_poll_calls']=catsum(C,is_wait,0); K['coord_poll_h']=catsum(C,is_wait,1)/3600
    K['coord_poll_share']=K['coord_poll_h']/K['coord_active_h'] if K['coord_active_h'] else 0
    ce=[E[r['path']] for r in C if r['path'] in E and 'miss_n' in E[r['path']]]
    K['coord_miss_turns']=sum(e['miss_n'] for e in ce); K['coord_miss_M']=sum(e['miss_cc'] for e in ce)/1e6
    K['coord_miss_premium_usd']=sum(e['miss_cc']*1.15*PRICE.get(rtier(r),0)/1e6 for r in C for e in [E.get(r['path'])] if e and 'miss_cc' in e)
    # executors
    X=[r for r in R if role(r)=='gsd-executor']
    ea=sum(r['active'] for r in X)/3600
    K['exec_spawns']=len(X); K['exec_active_h']=ea
    K['exec_wait_h']=catsum(X,is_wait,1)/3600; K['exec_wait_share']=K['exec_wait_h']/ea if ea else 0
    K['exec_test_h']=catsum(X,is_test,1)/3600; K['exec_test_share']=K['exec_test_h']/ea if ea else 0
    K['exec_mut_h']=catsum(X,lambda k:k=='bash:mutation',1)/3600
    K['exec_poll_calls']=catsum(X,is_wait,0)
    # startup (first-turn) tokens per role
    st=[]
    for (ro,mo),L in sorted(G.items(),key=lambda kv:-len(kv[1])):
        v=[sum(r['first_turn'][1:4]) for r in L if r['first_turn'] and sum(r['first_turn'][1:4])>10000]
        if len(v)>=3 and ro not in('MAIN-session',): st.append((ro,mo,len(v),med(v),pct(v,90)))
    K['startup']=st
    # review / rulings per plan
    rev=[r for r in R if activity(r)=='review-verify' and r.get('last_text')]
    sonn=[r for r in rev if rtier(r)=='sonnet']; opu=[r for r in rev if rtier(r)=='opus']
    P=collections.defaultdict(lambda:{'son':0,'opus':0,'other':0,'ruling':0,'fix':0,'exec':0,'zero':0})
    for r in R:
        p=plan_of(r)
        if not p: continue
        a=activity(r); x=P[p]
        if a=='plan-execution': x['exec']+=1
        elif a=='implementation-fix': x['fix']+=1
        elif a=='ruling': x['ruling']+=1
        elif a=='review-verify':
            if rtier(r)=='sonnet': x['son']+=1; x['zero']+= 1 if (r.get('last_text') and zero(r)) else 0
            else: x['other']+=1; x['opus']+= 1 if rtier(r)=='opus' else 0
    withrev=[p for p,x in P.items() if (x['exec']>0 or x['son']>0) and x['son']+x['other']>0]
    K['plans_reviewed']=len(withrev)
    K['sonnet_reviews_per_plan']=statistics.mean([P[p]['son'] for p in withrev]) if withrev else 0
    K['opus_reviews_per_plan']=statistics.mean([P[p]['opus'] for p in withrev]) if withrev else 0
    K['nonsonnet_reviews_per_plan']=statistics.mean([P[p]['other'] for p in withrev]) if withrev else 0
    K['rulings_per_plan']=statistics.mean([P[p]['ruling'] for p in withrev]) if withrev else 0
    K['fix_agents_per_plan']=statistics.mean([P[p]['fix'] for p in withrev]) if withrev else 0
    K['sonnet_zero_share']=sum(zero(r) for r in sonn)/len(sonn) if sonn else 0
    K['review_usd_share']=sum(tokens(r)[4] for r in R if activity(r) in('review-verify','ruling'))/tot[4] if tot[4] else 0
    # reliability
    K['api_error_deaths']=sum(1 for r in R if r.get('ended_err'))
    K['api_error_deaths_by_role']=collections.Counter(role(r) for r in R if r.get('ended_err')).most_common(5)
    res=[r for r in leaf if RESUME.search(r['meta'].get('description') or '')]
    K['resume_spawns']=len(res); K['resume_usd']=sum(tokens(r)[4] for r in res)
    K['coord_resume_spawns']=sum(1 for r in res if role(r)=='gsd-phase-coordinator')
    K['coord_resume_share']=K['coord_resume_spawns']/len(C) if C else 0
    K['compactions']=sum(r['api_errors'].get('compact_boundary',0) for r in R)
    K['compact_transcripts']=sum(1 for r in R if r['api_errors'].get('compact_boundary'))
    K['exec_compact']=sum(1 for r in X if r['api_errors'].get('compact_boundary'))
    K['exec_compact_rate']=K['exec_compact']/len(X) if X else 0
    kinds=collections.Counter()
    for r in R:
        for ts,k in r['api_err_list']: kinds[k]+=1
    K['api_err_kinds']=dict(kinds)
    # mutation
    M=[r for r in R if activity(r)=='mutation']
    K['mut_spawns']=len(M); K['mut_active_h']=sum(r['active'] for r in M)/3600; K['mut_usd']=sum(tokens(r)[4] for r in M)
    K['mut_bash_calls']=catsum(leaf,lambda k:k=='bash:mutation',0); K['mut_bash_h']=catsum(leaf,lambda k:k=='bash:mutation',1)/3600
    # charlotte
    CH=[r for r in R if role(r)=='charlotte-runner-session']
    shots=[];per_run=[]
    for r in CH:
        e=E.get(r['path'])
        if not e or 'shots' not in e: continue
        shots+=e['shots']
        w=wall(r)
        per_run.append(sum(d for d,t in e['shots'] if t)/w if w>0 and e['shots'] else 0)
    K['ch_runs']=len(CH); K['ch_wall_min_med']=med([wall(r)/60 for r in CH])
    K['ch_shots']=len(shots); K['ch_shot_p50_s']=med([d for d,t in shots]); K['ch_shot_p90_s']=pct([d for d,t in shots],90)
    K['ch_shot_mean_s']=statistics.mean([d for d,t in shots]) if shots else 0
    K['ch_shot_timeouts']=sum(t for d,t in shots)
    ok=[d for d,t in shots if not t]; K['ch_shot_ok_n']=len(ok); K['ch_shot_ok_p50_s']=med(ok)
    wsum=sum(wall(r) for r in CH)
    K['ch_timeout_wall_share_agg']=sum(d for d,t in shots if t)/wsum if wsum else 0
    K['ch_timeout_wall_share_med']=med([x for x in per_run if x>0]) if per_run else 0
    qa=[r for r in R if role(r)=='gsd-charlotte-qa']; K['ch_qa_spawns']=len(qa)
    # git
    if with_git:
        com=git_numstat(lo if lo is not None else (min(r['t0'] for r in R) if R else None),hi)
        lc=collections.Counter()
        for c in com:
            for f,n in c['f']: lc[area(f)]+=n
        tl=sum(lc.values())
        K['git_commits']=len(com); K['git_lines']=tl
        K['git_planning_share']=lc['planning-docs']/tl if tl else 0
        K['git_src_mig_share']=(lc['src']+lc['migrations'])/tl if tl else 0
        K['git_planning_only_commit_share']=sum(1 for c in com if c['f'] and all(area(f) in('planning-docs','docs') for f,_ in c['f']))/len(com) if com else 0
    return K

# ---------- output ----------
def pctf(x): return '%.1f%%'%(100*x)
def render(K,lo,hi):
    def ts(x): return datetime.datetime.utcfromtimestamp(x).strftime('%Y-%m-%d %H:%MZ') if x else 'open'
    o=[]
    o.append('# GSD v2 KPI table  window [%s, %s)  transcripts %d  spawns %d  est $%.0f'%(ts(lo),ts(hi),K['transcripts'],K['spawns'],K['est_usd']))
    o.append('')
    o.append('## Per role x model')
    o.append('| role | model | spawns | active h | est $ | $/spawn | first-turn tok (med) |')
    o.append('|---|---|---|---|---|---|---|')
    for x in K['role_model']:
        o.append('| %s | %s | %d | %.1f | %.0f | %.2f | %s |'%(x['role'],x['model'],x['spawns'],x['active_h'],x['usd'],x['usd_per_spawn'],'%d'%x['first_turn_tok_med'] if x['first_turn_tok_med'] else '-'))
    o.append('')
    o.append('## KPIs')
    o.append('| area | KPI | value |')
    o.append('|---|---|---|')
    def row(a,k,v): o.append('| %s | %s | %s |'%(a,k,v))
    row('tokens','fresh / cache-write / cache-read / output (M)','%.0f / %.0f / %.0f / %.0f'%(K['tok_fresh_M'],K['tok_cw_M'],K['tok_cr_M'],K['tok_out_M']))
    row('coordinator','spawns / active h','%d / %.0f'%(K['coord_spawns'],K['coord_active_h']))
    row('coordinator','cache-write M / cache-read M / ratio','%.0f / %.0f / %.3f'%(K['coord_cw_M'],K['coord_cr_M'],K['coord_cw_over_cr']))
    row('coordinator','poll calls / poll h / share of active','%d / %.0f / %s'%(K['coord_poll_calls'],K['coord_poll_h'],pctf(K['coord_poll_share'])))
    row('coordinator','cache-miss turns (idle>=300s) / tokens rewritten M / premium $','%d / %.0f / %.0f'%(K['coord_miss_turns'],K['coord_miss_M'],K['coord_miss_premium_usd']))
    row('executor','spawns / active h','%d / %.0f'%(K['exec_spawns'],K['exec_active_h']))
    row('executor','wait-poll h / share of active / calls','%.0f / %s / %d'%(K['exec_wait_h'],pctf(K['exec_wait_share']),K['exec_poll_calls']))
    row('executor','unit+integration test h / share; mutation-cmd h','%.0f / %s; %.1f'%(K['exec_test_h'],pctf(K['exec_test_share']),K['exec_mut_h']))
    row('review','plans reviewed','%d'%K['plans_reviewed'])
    row('review','Sonnet reviews / Opus reviews (non-Sonnet incl. Haiku) / rulings / fix agents per plan','%.2f / %.2f (%.2f) / %.2f / %.2f'%(K['sonnet_reviews_per_plan'],K['opus_reviews_per_plan'],K['nonsonnet_reviews_per_plan'],K['rulings_per_plan'],K['fix_agents_per_plan']))
    row('review','Sonnet zero-finding share; review+ruling share of est $','%s; %s'%(pctf(K['sonnet_zero_share']),pctf(K['review_usd_share'])))
    row('mutation','mutation-described spawns / active h / est $','%d / %.0f / %.0f'%(K['mut_spawns'],K['mut_active_h'],K['mut_usd']))
    row('mutation','mutation Bash calls / tool-wait h','%d / %.1f'%(K['mut_bash_calls'],K['mut_bash_h']))
    if 'git_lines' in K:
        row('git','non-merge commits / changed lines','%d / %d'%(K['git_commits'],K['git_lines']))
        row('git','.planning share of changed lines; src+migrations share','%s; %s'%(pctf(K['git_planning_share']),pctf(K['git_src_mig_share'])))
        row('git','planning/docs-only commit share',pctf(K['git_planning_only_commit_share']))
    row('reliability','transcripts ended on API error (top roles)','%d  %s'%(K['api_error_deaths'],K['api_error_deaths_by_role']))
    row('reliability','resume-style spawns / est $; coordinator resumes / share','%d / %.0f; %d / %s'%(K['resume_spawns'],K['resume_usd'],K['coord_resume_spawns'],pctf(K['coord_resume_share'])))
    row('reliability','compactions / transcripts with one; executors with compaction / rate','%d / %d; %d / %s'%(K['compactions'],K['compact_transcripts'],K['exec_compact'],pctf(K['exec_compact_rate'])))
    row('reliability','API error events by kind (capped 60/file)',K['api_err_kinds'])
    row('charlotte','runner runs / median wall min','%d / %.1f'%(K['ch_runs'],K['ch_wall_min_med']))
    row('charlotte','screenshot calls / p50 s / p90 s / mean s','%d / %.1f / %.1f / %.1f'%(K['ch_shots'],K['ch_shot_p50_s'],K['ch_shot_p90_s'],K['ch_shot_mean_s']))
    row('charlotte','screenshot timeouts / ok calls (p50 s) / share of runner wall lost (aggregate; per-run median)','%d / %d (%.1f) / %s (%s)'%(K['ch_shot_timeouts'],K['ch_shot_ok_n'],K['ch_shot_ok_p50_s'],pctf(K['ch_timeout_wall_share_agg']),pctf(K['ch_timeout_wall_share_med'])))
    o.append('')
    o.append('## Startup first-turn tokens (median / p90, spawns with first turn >10k tok)')
    o.append('| role | model | n | median | p90 |')
    o.append('|---|---|---|---|---|')
    for ro,mo,n,m,p in K['startup'][:16]: o.append('| %s | %s | %d | %d | %d |'%(ro,mo,n,m,p))
    return '\n'.join(o)

# ---------- self-test vs research/01-SESSION-ANALYSIS.md ----------
BASE01=[ # (label, 01 value, getter key or lambda)
 ('transcripts',4324,lambda K:K['transcripts']),
 ('tokens fresh M',74,lambda K:K['tok_fresh_M']),
 ('tokens cache-write M',1018,lambda K:K['tok_cw_M']),
 ('tokens cache-read M',22015,lambda K:K['tok_cr_M']),
 ('tokens output M',106,lambda K:K['tok_out_M']),
 ('est $ total (tier sum 4003+2126+660)',6789,lambda K:K['est_usd']),
 ('executor sonnet spawns',593,lambda K:K['_rm'].get(('gsd-executor','sonnet'),{}).get('spawns',0)),
 ('executor sonnet est $',1941,lambda K:K['_rm'].get(('gsd-executor','sonnet'),{}).get('usd',0)),
 ('executor sonnet active h',300,lambda K:K['_rm'].get(('gsd-executor','sonnet'),{}).get('active_h',0)),
 ('coordinator sonnet est $',1085,lambda K:K['_rm'].get(('gsd-phase-coordinator','sonnet'),{}).get('usd',0)),
 ('coordinator sonnet active h',495,lambda K:K['_rm'].get(('gsd-phase-coordinator','sonnet'),{}).get('active_h',0)),
 ('coordinator active h (all models)',501,lambda K:K['coord_active_h']),
 ('coordinator poll calls',3883,lambda K:K['coord_poll_calls']),
 ('coordinator poll h',454,lambda K:K['coord_poll_h']),
 ('coordinator poll share of active',0.906,lambda K:K['coord_poll_share']),
 ('coordinator cache-write M (01: 333 = sonnet coordinators)',333,lambda K:K['_rm_cw']),
 ('executor active h',405,lambda K:K['exec_active_h']),
 ('executor wait h',109,lambda K:K['exec_wait_h']),
 ('executor wait share',0.27,lambda K:K['exec_wait_share']),
 ('Sonnet reviews / reviewed plan',2.31,lambda K:K['sonnet_reviews_per_plan']),
 ('"Opus" reviews / reviewed plan (01 counts every non-Sonnet reviewer, Haiku included)',0.86,lambda K:K['nonsonnet_reviews_per_plan']),
 ('rulings / reviewed plan',1.25,lambda K:K['rulings_per_plan']),
 ('fix agents / reviewed plan',0.52,lambda K:K['fix_agents_per_plan']),
 ('Sonnet zero-finding share',0.216,lambda K:K['sonnet_zero_share']),
 ('non-merge commits',4452,lambda K:K.get('git_commits',0)),
 ('git changed lines',1960000,lambda K:K.get('git_lines',0)),
 ('.planning share of changed lines',0.512,lambda K:K.get('git_planning_share',0)),
 ('src+migrations share (11.6+5.9)',0.175,lambda K:K.get('git_src_mig_share',0)),
 ('transcripts ended on API error [01 per-role list sums to 113, headline says 128]',128,lambda K:K['api_error_deaths']),
 ('resume-style spawns',223,lambda K:K['resume_spawns']),
 ('resume-style spawns est $',928,lambda K:K['resume_usd']),
 ('coordinator resume-style spawns',38,lambda K:K['coord_resume_spawns']),
 ('compactions',475,lambda K:K['compactions']),
 ('transcripts with compaction',363,lambda K:K['compact_transcripts']),
 ('executors with compaction',244,lambda K:K['exec_compact']),
 ('charlotte runner runs',334,lambda K:K['ch_runs']),
 ('charlotte screenshot calls',522,lambda K:K['ch_shots']),
 ('charlotte screenshot timeouts',498,lambda K:K['ch_shot_timeouts']),
 ('charlotte screenshot mean s',173.3,lambda K:K['ch_shot_mean_s']),
 ('charlotte screenshot p90 s',180.0,lambda K:K['ch_shot_p90_s']),
 ('charlotte timeouts share of runner wall (25.1h/37h)',0.68,lambda K:K['ch_timeout_wall_share_agg']),
 ('charlotte runner median wall min',6.6,lambda K:K['ch_wall_min_med']),
 ('sonnet-coordinator cache-miss turns (>=300s idle)',2026,lambda K:K['_son_miss_n']),
 ('sonnet-coordinator miss tokens rewritten M',325,lambda K:K['_son_miss_M']),
 ('sonnet-coordinator cache-miss premium $ (01: 767)',767,lambda K:K['_son_premium']),
]
def selftest(K,E):
    import extract
    sm=sn=0
    for r in K['_R']:
        if (r['meta'] or {}).get('agentType')=='gsd-phase-coordinator' and rtier(r)=='sonnet':
            e=E.get(r['path'])
            if e is None or 'miss_n' not in e: continue
            if e['size']!=r['size']: e=extract.extra_cache(r['path'],limit=r['size'])
            sn+=e['miss_n']; sm+=e['miss_cc']
    K['_son_miss_n']=sn; K['_son_miss_M']=sm/1e6; K['_son_premium']=sm*1.15*PRICE['sonnet']/1e6
    K['_rm']={(x['role'],x['model']):x for x in K['role_model']}
    K['_rm_cw']=sum(tokens(r)[1] for r in K['_R'] if role(r)=='gsd-phase-coordinator' and rtier(r)=='sonnet')/1e6
    o=['| metric | 01 value | v2 value | dev | within 1% |','|---|---|---|---|---|']
    ok=0
    for lab,b,g in BASE01:
        v=g(K); dev=(v-b)/b if b else 0; w=abs(dev)<=0.01; ok+=w
        o.append('| %s | %s | %s | %+.2f%% | %s |'%(lab,b,('%.3f'%v) if isinstance(v,float) and abs(v)<10 else ('%.1f'%v if isinstance(v,float) else v),100*dev,'yes' if w else 'NO'))
    o.append('')
    o.append('within 1%%: %d of %d'%(ok,len(BASE01)))
    return '\n'.join(o)

ROW_COLS=['est $','coord cw/cr','coord polls','exec wait %','Sonnet rev/plan','rulings/plan','.planning %','API deaths','coord resume %','exec compact %','shot p50 s','shot timeouts']
def row(K,lo,hi):
    f=lambda x:datetime.datetime.utcfromtimestamp(x).strftime('%m-%d') if x else 'open'
    v=['%s..%s'%(f(lo),f(hi)),'%.0f'%K['est_usd'],'%.2f'%K['coord_cw_over_cr'],'%d'%K['coord_poll_calls'],'%.0f'%(100*K['exec_wait_share']),'%.2f'%K['sonnet_reviews_per_plan'],'%.2f'%K['rulings_per_plan'],
       '%.0f'%(100*K.get('git_planning_share',0)),'%d'%K['api_error_deaths'],'%.0f'%(100*K['coord_resume_share']),'%.0f'%(100*K['exec_compact_rate']),'%.0f'%K['ch_shot_p50_s'],'%d'%K['ch_shot_timeouts']]
    return '| window | '+' | '.join(ROW_COLS)+' |\n|'+'---|'*(len(ROW_COLS)+1)+'\n| '+' | '.join(v)+' |'

def main():
    a=sys.argv[1:]
    if '--no-refresh' not in a:
        import extract
        w=int(a[a.index('--workers')+1]) if '--workers' in a else 3
        extract.refresh(out_dir(),w); extract.refresh_extras(out_dir(),w)
    lo,hi=window()
    R=load(); E=load_extras()
    K=compute(R,E,lo,hi,with_git='--no-git' not in a)
    K['_R']=R
    if '--selftest' in a:
        print(render(K,lo,hi)); print(); print('## Self-test vs 01-SESSION-ANALYSIS.md'); print(selftest(K,E)); return
    if '--row' in a:
        print(row(K,lo,hi)); return
    if '--json' in a:
        K.pop('_R',None); print(json.dumps(K,default=str)); return
    s=render(K,lo,hi); print(s)
    d=os.path.join(out_dir(),'kpi'); os.makedirs(d,exist_ok=True)
    fn=os.path.join(d,'kpi_%s.md'%datetime.datetime.utcnow().strftime('%Y%m%dT%H%M%SZ'))
    open(fn,'w').write(s+'\n'); print('\nwritten',fn,file=sys.stderr)
if __name__=='__main__': main()
