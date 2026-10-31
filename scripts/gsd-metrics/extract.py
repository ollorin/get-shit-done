#!/usr/bin/env python3
"""Incrementally stream transcripts (top-level + subagents + charlotte project) -> one summary record per file (<GSD_OUT>/files.jsonl). process() is unchanged from 02_extract.py."""
import json,os,re,sys,glob,collections
from datetime import datetime
from multiprocessing import Pool
BASE=os.path.expanduser('~/.claude/projects/')
PROJ=['-Users-ollorin-igaming-platform','-Users-ollorin-igaming-platform-apps-e2e-charlotte']
def ep(ts):
    return datetime.fromisoformat(ts[:-1]+'+00:00').timestamp()

RX_STACK=re.compile(r'orbctl|supabase (start|stop|db reset|functions serve)|npx supabase (start|stop|db reset|functions)|docker (restart|stop|start|compose|rm|kill)|colima|nx (start|stop):dev|functions serve')
RX_PREF=re.compile(r'preflight')
RX_MUT=re.compile(r'mutant|mutation|mut-M|-mut\b|MUTANT')
RX_INT=re.compile(r'run-integration-tests|test:integration|integration')
RX_TEST=re.compile(r'deno (task )?test|nx test|vitest|test:ci|playwright|test:regression|npm (run )?test|\bjest\b')
RX_COV=re.compile(r'coverage')
RX_GATE=re.compile(r'deno (lint|check|fmt)|fp-gate|nx (run )?[\w:-]*(lint|typecheck|build)|check-p0|cve-scan|vale |markdownlint|scripts/validation|\btsc\b|eslint|guard|ci-diagnose')
RX_WAIT=re.compile(r'(^|[\s;&|(])(sleep|until|while|ping -c)\s|tail -f|\bwait\b|watch |seq 1 \d+\); do')
RX_GIT=re.compile(r'(^|[\s;&|(])(rtk )?git\s')
RX_GSD=re.compile(r'gsd-tools|get-shit-done')
RX_LOCK=re.compile(r'stack-lock')
RX_HOST=re.compile(r'\bdf -h|docker (ps|images|system|stats|logs|exec)|du -s|rm -rf [^ ]*(node_modules|\.nx|\.next|\.deno|dist)|vm_stat|pgrep|\bps -|\blsof|kill ')
RX_FILE=re.compile(r'^\s*(cd [^;&]*(&&|;)\s*)?(cat|ls|head|tail|sed|awk|wc|stat|mkdir|cp|mv|rm|touch|echo|diff|cmp|python3|perl|node|jq|tr|sort|date)\b')
RX_SEARCH=re.compile(r'zg |\brg\b|\bgrep\b')
RX_CHAR=re.compile(r'charlotte|e2e')
def cat_bash(cmd):
    c=cmd
    if RX_PREF.search(c): return 'bash:preflight'
    if RX_WAIT.search(c) and not RX_TEST.search(c) and not RX_INT.search(c): return 'bash:wait-poll'
    if RX_STACK.search(c) and not RX_TEST.search(c): return 'bash:stack-ops'
    if RX_MUT.search(c): return 'bash:mutation'
    if RX_INT.search(c): return 'bash:integration-test'
    if RX_TEST.search(c): return 'bash:test'
    if RX_COV.search(c): return 'bash:coverage'
    if RX_GATE.search(c): return 'bash:gates-lint-check'
    if RX_CHAR.search(c): return 'bash:charlotte'
    if RX_LOCK.search(c): return 'bash:stack-lock-run'
    if RX_HOST.search(c): return 'bash:host-disk-proc'
    if RX_GSD.search(c): return 'bash:gsd-tools'
    if RX_GIT.search(c): return 'bash:git'
    if RX_SEARCH.search(c): return 'bash:search'
    if RX_FILE.search(c): return 'bash:file-inspect-script'
    return 'bash:other'
def cat_path(p):
    if not p: return 'unk'
    if '/.planning/' in p or '/.tmp/' in p or 'evidence' in p or 'FINDINGS' in p or p.endswith('.md'): return 'planning-docs'
    if re.search(r'\.test\.|_test\.|/tests?/|/e2e|\.spec\.|/__tests__/|e2e-charlotte',p): return 'test'
    if '/docs/' in p: return 'docs'
    return 'impl'
def cat_tool(name,inp):
    if not isinstance(inp,dict): inp={}
    if name=='Bash': return cat_bash(str(inp.get('command','') or ''))
    if name in('Agent','Task'): return 'spawn:'+str(inp.get('subagent_type'))
    if name in('Edit','Write','NotebookEdit','MultiEdit'): return 'edit:'+cat_path(str(inp.get('file_path','')))
    if name=='Read': return 'read:'+cat_path(str(inp.get('file_path','')))
    if name.startswith('mcp__charlotte'): return 'mcp:charlotte'
    if name in('TaskOutput','Monitor','TaskStop','ScheduleWakeup','CronCreate','CronList','CronDelete','TaskList','TaskGet'): return 'wait:'+name
    if name=='SendMessage': return 'msg:SendMessage'
    return 'tool:'+name
def clen(c):
    if isinstance(c,str): return len(c)
    if isinstance(c,list):
        n=0
        for b in c:
            if isinstance(b,dict):
                if b.get('type')=='text': n+=len(b.get('text',''))
                elif b.get('type')=='image': n+=len(b.get('source',{}).get('data',''))//1  # base64 chars
                else: n+=len(str(b))
        return n
    return len(str(c))
RX_ATT=re.compile(r'"attachment":\{"type":"([\w]+)"')
def err_kind(tx):
    t=tx.lower()
    if 'session limit' in t: return 'session_limit'
    if 'weekly limit' in t: return 'weekly_limit'
    if 'limit' in t and 'resets' in t: return 'other_limit'
    if 'prompt is too long' in t or 'context' in t and 'exceed' in t: return 'context_overflow'
    if 'enotfound' in t or "can't reach" in t: return 'network'
    if 'malformed' in t: return 'malformed_200'
    if 'overloaded' in t or '529' in t: return 'overloaded'
    if 'selected model' in t: return 'model_unavailable'
    if 'rate' in t and 'limit' in t: return 'rate_limit'
    return 'other:'+t[:50]
def process(args):
    path,proj,kind=args
    rec={'path':path,'proj':proj,'kind':kind,'size':os.path.getsize(path)}
    sess=None;agent=None
    meta={}
    mp=path[:-6]+'.meta.json'
    if kind=='sub' and os.path.exists(mp):
        try: meta=json.load(open(mp))
        except Exception: meta={}
    rec['meta']=meta
    usage={} # msgid -> [model,in,cc,cr,out,ts_first]
    order=[]
    att=collections.Counter(); attb=collections.Counter()
    instr=[]; nested=[]
    tool_use={} # id -> (ts,name,cat,msgid,inp-snippet)
    cat=collections.defaultdict(lambda:[0,0.0,0,0,0,0])  # n,dur,in,cc,cr,out  (tokens attributed by msg's first tool)
    tool_res_chars=collections.defaultdict(lambda:[0,0])
    slow=[]
    first_ts=last_ts=None
    first_prompt=None; first_reads=[]
    n_assist_started=0
    gen_time=0.0; tool_time=0.0
    last_user_ts=None; last_asst_end=None; cur_msg=None; cur_first=None
    api_errors=collections.Counter(); api_err_samples=[]; api_err_list=[]; last_was_err=False; series=[]; claude_reads=collections.defaultdict(lambda:[0,0]); last_text=None; active=0.0; prev_e=None; idle_gaps=[]
    cost=None; ncost=0
    msg_cat={} # msgid -> cat
    stop_reasons=collections.Counter()
    last_type=None; last_event_summary=None
    tool_counts=collections.Counter()
    sidx=None
    shape_info=None
    ntools_seen=0
    gaps_long=[]
    compact=0
    try:
        f=open(path,'r',errors='replace')
    except Exception as e:
        rec['err']=str(e); return rec
    with f:
        for line in f:
            if line.startswith('{"type":"api-request-shape"') and shape_info is None:
                try:
                    d=json.loads(line); sh=d['shape']
                    shape_info={'system_chars':len(json.dumps(sh.get('system'))),'tools_chars':len(json.dumps(sh.get('tools'))),'n_tools':len(sh.get('tools') or [])}
                except Exception: pass
                continue
            if line.startswith('{"type":"api-request'): continue
            if line.startswith('{"type":"queue-operation"') or line.startswith('{"type":"last-prompt"') or line.startswith('{"type":"atis-latch"'): continue
            if line.startswith('{"type":"cost-state"'):
                try:
                    cc_=json.loads(line)
                    if cost is None or (cc_.get('totalCostUSD') or 0)>=(cost.get('totalCostUSD') or 0): cost=cc_
                    ncost+=1
                except Exception: pass
                continue
            m=RX_ATT.search(line[:700])
            if m:
                t=m.group(1); att[t]+=1; attb[t]+=len(line)
                if t in('instructions','nested_memory') and n_assist_started<=2:
                    try:
                        d=json.loads(line)['attachment']
                        if t=='instructions':
                            for fl in d.get('files',[]): instr.append((fl.get('path'),len(fl.get('content',''))))
                        else:
                            c=d.get('content',{}); nested.append((d.get('path'),len(c.get('content','')) if isinstance(c,dict) else 0, n_assist_started))
                    except Exception: pass
                continue
            try: d=json.loads(line)
            except Exception: continue
            t=d.get('type')
            ts=d.get('timestamp')
            if t=='system':
                st=d.get('subtype')
                if st=='api_error' or st=='compact_boundary':
                    api_errors[st]+=1
                    if st=='api_error' and len(api_err_samples)<5: api_err_samples.append(str(d.get('content') or d.get('error') or d)[:200])
                continue
            if t not in('user','assistant') or not ts: continue
            e=ep(ts)
            if first_ts is None: first_ts=e
            last_ts=e
            if prev_e is not None:
                g=e-prev_e
                if g<1800: active+=g
                else: idle_gaps.append([round(prev_e),round(g)])
            prev_e=e
            if sess is None: sess=d.get('sessionId')
            if t=='assistant':
                msg=d['message']; mid=msg.get('id'); u=msg.get('usage') or {}
                if d.get('isApiErrorMessage'):
                    api_errors['apiErrorMessage']+=1
                    tx=str(msg.get('content'))
                    k=err_kind(tx)
                    api_errors['kind:'+k]+=1
                    if len(api_err_list)<60: api_err_list.append((ts,k))
                    if len(api_err_samples)<3: api_err_samples.append(tx[:200])
                    last_was_err=True
                else: last_was_err=False
                if mid not in usage:
                    usage[mid]=[msg.get('model'),u.get('input_tokens') or 0,u.get('cache_creation_input_tokens') or 0,u.get('cache_read_input_tokens') or 0,u.get('output_tokens') or 0,e]
                    order.append(mid)
                    n_assist_started+=1
                    series.append([usage[mid][1]+usage[mid][2]+usage[mid][3],0,None])
                    # new message begins: tool wait since last assistant end
                    if last_asst_end is not None and last_user_ts is not None and last_user_ts>=last_asst_end:
                        tool_time+=last_user_ts-last_asst_end
                    cur_first=last_user_ts if last_user_ts is not None else e
                else:
                    usage[mid][4]=max(usage[mid][4],u.get('output_tokens') or 0)
                if msg.get('stop_reason'): stop_reasons[msg['stop_reason']]+=1
                last_asst_end=e; cur_msg=mid
                gen_time_inc=0
                content=msg.get('content')
                if isinstance(content,list):
                    for b in content:
                        if b.get('type')=='text' and b.get('text'): last_text=b['text'][:900]
                        if b.get('type')=='tool_use':
                            nm=b.get('name'); inp=b.get('input') or {}
                            if not isinstance(inp,dict): inp={}
                            c=cat_tool(nm,inp)
                            tool_counts[nm]+=1
                            if mid not in msg_cat:
                                msg_cat[mid]=c; series[-1][2]=c
                            sn=''
                            if not isinstance(inp,dict): inp={}
                            if nm=='Bash': sn=str(inp.get('command') or '')[:200]
                            elif nm in('Agent','Task'): sn=str(inp.get('subagent_type'))+'|'+str(inp.get('model'))+'|'+str(inp.get('description'))[:100]+'|bg=' + str(inp.get('run_in_background'))
                            elif 'file_path' in inp: sn=inp['file_path']
                            tool_use[b.get('id')]=(e,nm,c,sn,n_assist_started)
            else: # user
                last_user_ts=e
                if last_asst_end is not None:
                    pass
                msg=d.get('message') or {}
                content=msg.get('content')
                if isinstance(content,str):
                    if first_prompt is None: first_prompt=content[:1500]
                elif isinstance(content,list):
                    for b in content:
                        bt=b.get('type')
                        if bt=='text' and first_prompt is None and n_assist_started==0: first_prompt=b.get('text','')[:1500]
                        if bt=='tool_result':
                            tid=b.get('tool_use_id'); tu=tool_use.pop(tid,None)
                            L=clen(b.get('content'))
                            if tu:
                                dur=e-tu[0]; c=tu[2]; nm=tu[1]
                                x=cat[c]; x[0]+=1; x[1]+=dur
                                tr=tool_res_chars[nm]; tr[0]+=1; tr[1]+=L
                                if dur>=120: slow.append((round(dur),c,nm,tu[3][:160],ep and ts))
                                if nm=='Read':
                                    if tu[4]<=40 and len(first_reads)<70: first_reads.append((tu[3],L,tu[4]))
                                    if '/.claude/' in tu[3] or tu[3].endswith('CLAUDE.md'):
                                        cr_=claude_reads[tu[3]]; cr_[0]+=1; cr_[1]+=L
    # tokens
    tot=collections.defaultdict(lambda:[0,0,0,0,0])
    for mid in order:
        mdl,i,cc,cr,o,tse=usage[mid]
        k=mdl or 'unk'
        a=tot[k]; a[0]+=1;a[1]+=i;a[2]+=cc;a[3]+=cr;a[4]+=o
        c=msg_cat.get(mid,'noTool')
        x=cat[c]; x[2]+=i;x[3]+=cc;x[4]+=cr;x[5]+=o
    rec.update({'sess':sess,'t0':first_ts,'t1':last_ts,'n_msgs':len(order),'tok':{k:v for k,v in tot.items()},
        'first_turn':usage[order[0]][:5] if order else None,
        'second_turn':usage[order[1]][:5] if len(order)>1 else None,
        'max_ctx':max([u[1]+u[2]+u[3] for u in usage.values()] or [0]),
        'cat':{k:v for k,v in cat.items()},'tool_counts':dict(tool_counts),
        'tool_res_chars':{k:v for k,v in tool_res_chars.items()},
        'slow':sorted(slow,reverse=True)[:12],'att':dict(att),'attb':dict(attb),'instr':instr,'nested':nested[:30],
        'first_reads':first_reads,'first_prompt':first_prompt,'api_errors':dict(api_errors),'api_err_samples':api_err_samples,
        'tool_time':tool_time,'shape':shape_info,'stop':dict(stop_reasons),'unfinished_tools':len(tool_use),'api_err_list':api_err_list,'ended_err':last_was_err,'series':[[a,b,c] for a,b,c in series],'claude_reads':dict(claude_reads),'last_text':last_text,'active':active,'idle_gaps':idle_gaps[:300],'n_idle':len(idle_gaps),'idle_total':sum(x[1] for x in idle_gaps)})
    if cost: rec['ncost']=ncost; rec['cost']={k:cost.get(k) for k in('totalCostUSD','totalAPIDuration','totalToolDuration','totalDuration','startTime','totalLinesAdded','totalLinesRemoved')}; rec['cost_models']=cost.get('modelUsage')
    # last tool_use unanswered => died while in tool
    return rec
def _jobs():
    jobs=[]
    for proj in PROJ:
        d=BASE+proj
        for p in glob.glob(d+'/*.jsonl'): jobs.append((p,proj,'top'))
        for p in glob.glob(d+'/*/subagents/*.jsonl'): jobs.append((p,proj,'sub'))
    return jobs

def refresh(out_dir,workers=3,full=False,log=sys.stderr):
    """Incremental: re-process only transcripts that are new, grew since last run, or whose meta.json appeared."""
    os.makedirs(out_dir,exist_ok=True)
    path=os.path.join(out_dir,'files.jsonl')
    old={}
    if os.path.exists(path) and not full:
        for l in open(path):
            try: r=json.loads(l)
            except Exception: continue
            old[r['path']]=r
    jobs=_jobs(); todo=[]
    for j in jobs:
        r=old.get(j[0])
        if r is None or r.get('size')!=os.path.getsize(j[0]): todo.append(j)
        elif j[2]=='sub' and not r.get('meta') and os.path.exists(j[0][:-6]+'.meta.json'): todo.append(j)
    todo.sort(key=lambda j:-os.path.getsize(j[0]))
    print('files %d, cached %d, to (re)process %d'%(len(jobs),len(old),len(todo)),file=log,flush=True)
    if todo:
        with Pool(workers) as pool:
            for r in pool.imap_unordered(process,todo,chunksize=1): old[r['path']]=r
        tmp=path+'.tmp'
        with open(tmp,'w') as out:
            for r in old.values(): out.write(json.dumps(r)+'\n')
        os.replace(tmp,path)
    return len(jobs),len(todo)


# ---- sidecar extras (only the files that need a second pass): charlotte runner tool timings, coordinator cache-miss turns
def _ep(ts): return datetime.fromisoformat(ts[:-1]+'+00:00').timestamp()
def extra_charlotte(path):
    tu={}; shots=[]; tools={}
    for line in open(path,errors='replace'):
        if line.startswith('{"type":'): continue
        if 'mcp__charlotte' not in line and '"tool_use_id"' not in line: continue
        try: d=json.loads(line)
        except Exception: continue
        c=(d.get('message') or {}).get('content')
        if not isinstance(c,list) or not d.get('timestamp'): continue
        for b in c:
            if b.get('type')=='tool_use' and str(b.get('name')).startswith('mcp__charlotte'):
                tu[b['id']]=(_ep(d['timestamp']),b['name'].replace('mcp__charlotte__charlotte_',''))
            elif b.get('type')=='tool_result' and b.get('tool_use_id') in tu:
                t0,n=tu.pop(b['tool_use_id']); dur=_ep(d['timestamp'])-t0
                x=tools.setdefault(n,[0,0.0]); x[0]+=1; x[1]+=dur
                if n=='screenshot':
                    bc=b.get('content'); tx=bc if isinstance(bc,str) else ' '.join(str(y.get('text','')) for y in (bc or []) if isinstance(y,dict))
                    shots.append([round(dur,2),1 if 'timed out' in tx else 0])
    return {'shots':shots,'tools':tools}
def extra_cache(path,limit=None):
    """limit: only read the first `limit` bytes (self-test: freeze a since-grown file at its snapshot size)."""
    seen=set(); last_asst=None; last_user=None; miss_cc=miss_n=tot_cc=first_cc=n=0
    if limit:
        lines=open(path,'rb').read(limit).decode('utf8','replace').split('\n')[:-1]
    else: lines=open(path,errors='replace')
    for line in lines:
        if line.startswith('{"type":'): continue
        h=line[:400]
        if '"type":"assistant"' not in h and '"type":"user"' not in h and '"role"' not in line[:600]: continue
        try: d=json.loads(line)
        except Exception: continue
        t=d.get('type')
        if t not in('assistant','user') or not d.get('timestamp'): continue
        e=_ep(d['timestamp'])
        if t=='user': last_user=e; continue
        m=d['message']; mid=m.get('id')
        if mid in seen: last_asst=e; continue
        seen.add(mid); n+=1
        cc=(m.get('usage') or {}).get('cache_creation_input_tokens') or 0
        tot_cc+=cc
        if n==1: first_cc=cc
        elif last_asst is not None and last_user is not None and last_user>=last_asst and (last_user-last_asst)>=300 and cc>20000:
            miss_cc+=cc; miss_n+=1
        last_asst=e
    return {'miss_n':miss_n,'miss_cc':miss_cc,'tot_cc':tot_cc,'first_cc':first_cc}
def _extra_job(a):
    kind,path,size=a
    try: r=extra_charlotte(path) if kind=='charlotte' else extra_cache(path)
    except Exception as ex: r={'err':str(ex)}
    r.update({'path':path,'kind':kind,'size':size}); return r
def refresh_extras(out_dir,workers=3,log=sys.stderr):
    fp=os.path.join(out_dir,'files.jsonl'); ep_=os.path.join(out_dir,'extras.jsonl')
    old={}
    if os.path.exists(ep_):
        for l in open(ep_):
            try: r=json.loads(l)
            except Exception: continue
            old[r['path']]=r
    todo=[]
    for l in open(fp):
        r=json.loads(l)
        if r.get('t0') is None: continue
        k='charlotte' if r['proj'].endswith('charlotte') else ('cache' if (r.get('meta') or {}).get('agentType')=='gsd-phase-coordinator' else None)
        if not k: continue
        o=old.get(r['path'])
        if o is None or o['size']!=r['size']: todo.append((k,r['path'],r['size']))
    print('extras to (re)process %d'%len(todo),file=log,flush=True)
    if todo:
        with Pool(workers) as pool:
            for r in pool.imap_unordered(_extra_job,todo,chunksize=1): old[r['path']]=r
        tmp=ep_+'.tmp'
        with open(tmp,'w') as out:
            for r in old.values(): out.write(json.dumps(r)+'\n')
        os.replace(tmp,ep_)
    return len(todo)

def main():
    out=os.environ.get('GSD_OUT') or os.path.join(os.environ.get('GSD_REPO','/Users/ollorin/igaming-platform'),'.tmp','gsd-v2','out')
    w=int(sys.argv[1]) if len(sys.argv)>1 and sys.argv[1].isdigit() else 3
    refresh(out,w,full='--full' in sys.argv)
    refresh_extras(out,w)
if __name__=='__main__': main()
