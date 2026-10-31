#!/usr/bin/env python3
"""Experiment 05: per-call timeline for every leaf spawn that belongs to phases 398-402 (read-only on transcripts)."""
import sys,os,re,json,collections
from multiprocessing import Pool
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from lib import *
import datetime as _dtm
def ep(ts): return _dtm.datetime.fromisoformat(ts[:-1]+'+00:00').timestamp()
A=re.compile(r'\b(39[89]|40[0-2])(?:\.\d)?-(\d{2}[a-z]?)')
B=re.compile(r'\b[Pp]hase (39[89]|40[0-2])\b')
C=re.compile(r'\b(39[89]|40[0-2])\b')
OTHER=re.compile(r'\b(40[3-9]|39[0-7])\b')
T0_MIN=parse_ts('2026-10-14T10:00:00Z')
def tag(r):
    d=r['meta'].get('description') or ''; p=(r.get('first_prompt') or '')[:800]
    m=A.search(d)
    if m: return m.group(1),m.group(1)+'-'+m.group(2)
    if OTHER.search(d) and not C.search(d): return None
    m=A.search(p)
    if m and not (OTHER.search(d)): return m.group(1),m.group(1)+'-'+m.group(2)
    m=B.search(d) or B.search(p)
    if m: return m.group(1),None
    m=C.search(d)
    if m: return m.group(1),None
    return None
STRONG=re.compile(r"mutants?\b|\bmutate[sd]?\b|MUTANT|mutation[ _-]?(?:proof|proven|log|run|red|evidence|test|window|cycle|id|table|ledger|register|guard|check|sweep|batch|task|step|survivor|kill)|mutations? (?:M\d|\d+\b|batch)|orig-def|(?:/\.tmp/|-evidence/|test-runs/)[^\s'\"]*-(?:m|mr|mut|mutant)(?:\d+[a-z]?|-[a-z0-9]+)(?:[-_.][a-z0-9.-]*)?\.(?:log|txt|sql|diff|md)\b|\.tmp/[^\s'\"]*-(?:m|mr|mut)(?:\d+[a-z]?|-[a-z0-9]+)(?:[-_.][a-z0-9.-]*)?\.(?:log|txt|sql|diff|md)\b",re.I)
WEAK=re.compile(r"mutation",re.I)
def sg(s):
    if STRONG.search(s): return 2
    return 1 if WEAK.search(s) else 0
RX_WAIT=re.compile(r'(^|[\s;&|(])(sleep|until|while|ping -c)\s|tail -f|\bwait\b|seq 1 \d+\); do|perl -e .sleep')
RX_TEST=re.compile(r'deno (task )?test|run-integration-tests|vitest|nx test|test:ci|test:regression|npm (run )?test')
def cls_bash(c):
    if RX_TEST.search(c):
        if 'run-integration-tests' in c or re.search(r'bucket|B\d[a-z]?\b',c) and 'integration' in c: return 'test-bucket'
        if 'test:ci' in c or 'nx test' in c or 'nx run-many' in c: return 'test-suite'
        mm=re.search(r'(?:deno (?:task )?test|vitest)\s+(.*)',c)
        args=mm.group(1) if mm else ''
        if '.integration.test' in args or 'integration' in args: return 'test-live-file'
        if re.search(r'\.test\.ts|\.test\.tsx',args): return 'test-unit-file'
        return 'test-suite'
    if re.search(r'db reset',c): return 'db-reset'
    if re.search(r'stack-lock|orbctl|supabase (start|stop)|functions serve|docker (restart|stop|start|compose|exec|ps)|colima|psql',c): return 'stack-db'
    if RX_WAIT.search(c): return 'wait'
    if re.search(r'preflight|deno (lint|check|fmt)|fp-gate|check-p0|vale|markdownlint|scripts/validation',c): return 'gates'
    if re.search(r'(^|[\s;&|(])(rtk )?git\s',c): return 'git'
    if re.search(r'zg |\brg\b|\bgrep\b',c): return 'search'
    return 'bash-other'
def cls_path(p):
    if not p: return 'edit-other'
    if re.search(r'-evidence/|FINDINGS|/\.planning/|\.md$',p): return 'edit-plan'
    if '/.tmp/' in p: return 'edit-tmp'
    if re.search(r'\.test\.|_test\.|/__tests__/|/tests?/',p): return 'edit-test'
    return 'edit-prod'
def process(a):
    path,info=a
    turns={}; order=[]; calls=[]; tu={}; first=None
    for line in open(path,errors='replace'):
        if line.startswith('{"type":'): continue
        try: d=json.loads(line)
        except Exception: continue
        t=d.get('type'); ts=d.get('timestamp')
        if t not in('assistant','user') or not ts: continue
        e=ep(ts); first=first or e
        msg=d.get('message') or {}; c=msg.get('content')
        if t=='assistant':
            mid=msg.get('id'); u=msg.get('usage') or {}
            if mid not in turns:
                turns[mid]=[round(e,1),u.get('input_tokens') or 0,u.get('cache_creation_input_tokens') or 0,u.get('cache_read_input_tokens') or 0,u.get('output_tokens') or 0]; order.append(mid)
            else: turns[mid][4]=max(turns[mid][4],u.get('output_tokens') or 0)
            if isinstance(c,list):
                for b in c:
                    if b.get('type')!='tool_use': continue
                    nm=b.get('name'); inp=b.get('input') if isinstance(b.get('input'),dict) else {}
                    if nm=='Bash':
                        cmd=str(inp.get('command') or ''); k=cls_bash(cmd); sig=sg(cmd)
                    elif nm in('Edit','Write','MultiEdit','NotebookEdit'):
                        fp=str(inp.get('file_path') or ''); k=cls_path(fp)
                        body=str(inp.get('new_string') or inp.get('content') or '')[:3000]
                        sig=2 if STRONG.search(fp) else (max(sg(body),1 if STRONG.search(body) else 0) if k!='edit-prod' else 0)
                    elif nm=='Read':
                        fp=str(inp.get('file_path') or ''); k='read'; sig=2 if STRONG.search(fp) else 0
                    elif nm in('Agent','Task'): k='spawn'; sig=0
                    else: k='tool:'+str(nm); sig=0
                    tu[b['id']]=[round(e,1),0.0,k,sig]
        else:
            if isinstance(c,list):
                for b in c:
                    if b.get('type')=='tool_result' and b.get('tool_use_id') in tu:
                        x=tu.pop(b['tool_use_id']); x[1]=round(e-x[0],1); calls.append(x)
    for x in tu.values(): calls.append(x)
    calls.sort()
    rec=dict(info); rec['turns']=[turns[m] for m in order]; rec['calls']=calls
    return rec
def main():
    out=out_dir(); R=load()
    scope=[]
    for r in R:
        if r['kind']!='sub' or r['t0']<T0_MIN: continue
        tg=tag(r); tagged=bool(tg)
        if not tg:
            d=r['meta'].get('description') or ''; p=(r.get('first_prompt') or '')[:1200]
            if re.search(r'\b(40[3-9]|39[0-7])(?:\.\d)?(?:-\d{2})?\b',d+' '+p) and not re.search(r'\b(39[89]|40[0-2])\b',d): continue
            tt=r['t0']
            ph='398' if tt<parse_ts('2026-10-15T10:56:00Z') else '399' if tt<parse_ts('2026-10-17T16:56:00Z') else '400' if tt<parse_ts('2026-10-30T16:25:00Z') else '401' if tt<parse_ts('2026-10-31T10:33:00Z') else '402'
            tg=(ph,None)
        info={'tagged':tagged,'path':r['path'],'size':r['size'],'phase':tg[0],'plan':tg[1],'role':role(r),'model':rtier(r),'desc':r['meta'].get('description'),'t0':r['t0'],'t1':r['t1'],'active':r['active'],'idle_gaps':r['idle_gaps'],'ended_err':r.get('ended_err')}
        scope.append((r['path'],info))
    print('scope',len(scope),file=sys.stderr)
    old={}
    fp=os.path.join(out,'mt_calls.jsonl')
    if os.path.exists(fp) and '--full' not in sys.argv:
        for l in open(fp):
            x=json.loads(l); old[x['path']]=x
    todo=[a for a in scope if a[0] not in old or old[a[0]]['size']!=a[1]['size']]
    scope_paths={a[0] for a in scope}
    print('todo',len(todo),file=sys.stderr,flush=True)
    with Pool(3) as pool:
        for x in pool.imap_unordered(process,sorted(todo,key=lambda a:-a[1]['size']),chunksize=1): old[x['path']]=x
    with open(fp+'.tmp','w') as f:
        for p,x in old.items():
            if p in scope_paths: f.write(json.dumps(x)+'\n')
    os.replace(fp+'.tmp',fp)
if __name__=='__main__': main()
