import json,collections,statistics,datetime
import os,datetime as _dt
def out_dir():
    return os.environ.get('GSD_OUT') or os.path.join(os.environ.get('GSD_REPO','/Users/ollorin/igaming-platform'),'.tmp','gsd-v2','out')
def parse_ts(s):
    """ISO timestamp or date (UTC) -> epoch seconds; None for empty."""
    if not s: return None
    s=s.strip()
    if len(s)==10: s+='T00:00:00'
    d=_dt.datetime.fromisoformat(s[:-1]+'+00:00' if s.endswith('Z') else s)
    if d.tzinfo is None: d=d.replace(tzinfo=_dt.timezone.utc)
    return d.timestamp()
def window(since=None,until=None):
    """(since_epoch, until_epoch); args override env GSD_SINCE / GSD_UNTIL."""
    return parse_ts(since or os.environ.get('GSD_SINCE')), parse_ts(until or os.environ.get('GSD_UNTIL'))
def load(since=None,until=None,files=None):
    """Records whose first timestamp t0 lies in [GSD_SINCE, GSD_UNTIL). files: override index path (env GSD_FILES)."""
    lo,hi=window(since,until)
    path=files or os.environ.get('GSD_FILES') or os.path.join(out_dir(),'files.jsonl')
    R=[]
    for l in open(path):
        r=json.loads(l)
        if r.get('t0') is None: continue
        if lo is not None and r['t0']<lo: continue
        if hi is not None and r['t0']>=hi: continue
        R.append(r)
    return R
def role(r):
    if r['proj'].endswith('charlotte'): return 'charlotte-runner-session'
    if r['kind']=='top': return 'MAIN-session'
    return r['meta'].get('agentType') or 'unknown'
def model(r):
    # dominant model by output tokens
    best=None;bo=-1
    for m,v in r['tok'].items():
        if v[4]+v[1]+v[2]>bo: bo=v[4]+v[1]+v[2];best=m
    if not best: return 'none'
    b=best.lower()
    for k in('opus','sonnet','haiku','fable'):
        if k in b: return k
    return best
def pct(a,p):
    if not a: return 0
    a=sorted(a); i=min(len(a)-1,int(round(p/100*(len(a)-1)))); return a[i]
def day(ts): return datetime.datetime.utcfromtimestamp(ts).strftime('%Y-%m-%d')

PRICE={'opus':2.8,'sonnet':2.05,'haiku':0.43,'haiku4':1.0}  # $/Mtok input, calibrated vs cost-state modelUsage (see report)
def tier(m):
    m=(m or '').lower()
    if 'haiku-4' in m: return 'haiku4'
    for k in('opus','sonnet','haiku'):
        if k in m: return k
    if 'stealth' in m: return 'stealth'
    return 'other'
def rtier(r):
    """tier used for pricing/grouping: actual model; stealth alias -> requested tier"""
    m=model(r)
    if m.startswith('stealth') or m in('none','<synthetic>'):
        mm=r['meta'].get('model')
        if mm in('opus','sonnet','haiku'): return mm
        return 'sonnet' if m.startswith('stealth') else 'none'
    return m
def tokens(r):
    """sum over models: (in,cc,cr,out), and est USD"""
    I=C=CR=O=0;usd=0
    for m,v in r['tok'].items():
        t=tier(m)
        if t=='stealth': t=rtier(r) if rtier(r) in PRICE else 'sonnet'
        i,cc,cr,o=v[1],v[2],v[3],v[4]
        I+=i;C+=cc;CR+=cr;O+=o
        p=PRICE.get(t,0)
        usd+=p*(i+1.25*cc+0.1*cr+5*o)/1e6
    return I,C,CR,O,usd
def wall(r): return r['t1']-r['t0']

import re
def norm_desc(d):
    d=(d or '').lower()
    return d
def activity(r):
    ro=role(r); d=norm_desc(r['meta'].get('description')); fp=(r.get('first_prompt') or '')[:300].lower()
    if ro=='MAIN-session': return 'main-orchestrator'
    if ro=='charlotte-runner-session': return 'charlotte-scenario-run'
    amap={'gsd-phase-coordinator':'coordinator','gsd-planner':'planning','gsd-phase-researcher':'planning','gsd-plan-checker':'plan-check','gsd-plan-attacker':'plan-check','gsd-plan-defender':'plan-check','gsd-plan-judge':'plan-check','gsd-verifier':'phase-verify','gsd-charlotte-qa':'charlotte-qa','gsd-docs-updater':'docs-update','gsd-debugger':'debug','gsd-test-writer':'test-writing','gsd-integration-checker':'phase-verify','gsd-codebase-mapper':'other','gsd-roadmapper':'planning','gsd-e2e-test-generator':'test-writing'}
    if ro in amap: return amap[ro]
    # executor / general-purpose / fork / Explore -> by description
    if re.search(r'sonnet re-check|sonnet round|round \d|re-check',d): return 'review-verify'
    if re.search(r'^opus (batch|step)|opus .*finaliz|full pass|\bx\d+ full|finalize x',d): return 'ruling'
    if re.search(r'^trace |investigat|diagnos',d): return 'review-verify'
    if re.search(r'kill .*(proc|hung)',d): return 'stack-host-ops'
    if re.search(r'orbstack|host cleanup|disk|ram cleanup|cleanup|supabase stack|health|db reset|lock release|stack|recover|worktree|free more',d): return 'stack-host-ops'
    if re.search(r'delivery report|status report',d): return 'status-report'
    if re.search(r'mutant|mutation|\bmut\b|kill-proof',d): return 'mutation'
    if re.search(r'charlotte',d): return 'charlotte-qa'
    if re.search(r'ruling|rule on|escalation|disputed|adjudicat|arbitrat|decision',d): return 'ruling'
    if re.search(r'review|reverif|re-verif|pre-verif|ver pass|verif|audit|zero-round|read-only|sec final|qual|investigat|probe',d): return 'review-verify'
    if re.search(r'bucket|test:ci|suite|all buckets|green|re-run|reruns|rerun|runs twice|run unit|run .*test|integration|regression|lint|preflight|gate',d): return 'test-run-gates'
    if re.search(r'register|findings|evidence|ledger|forward map|grid|manifest|classif|sweep|tsv|bookkeep|summary|route .*into|codify|part \d|inventory',d): return 'evidence-register'
    if re.search(r'red tests|write .*tests|tests? hygiene|test fix|add tests',d): return 'test-writing'
    if ro=='gsd-executor': return 'plan-execution'
    if re.search(r'fix|implement|migration|task \d|refactor|hardening|apply|continue|drive|exec|resume|land|finish|close',d): return 'implementation-fix'
    if ro=='Explore' or ro=='claude-code-guide': return 'explore'
    return 'other-gp'
