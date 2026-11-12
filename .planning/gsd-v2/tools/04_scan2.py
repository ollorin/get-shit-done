#!/usr/bin/env python3
"""Second pass: bash command-shape census (with durations), Skill/slash/gsd-tools usage, repeated identical test commands, GSD flow evidence."""
import json,os,re,sys,glob,collections
from datetime import datetime
from multiprocessing import Pool
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
BASE=os.path.expanduser('~/.claude/projects/')
PROJ=['<project-slug>','<project-slug>-apps-e2e-charlotte']
def ep(ts): return datetime.fromisoformat(ts[:-1]+'+00:00').timestamp()
RX_CD=re.compile(r'^\s*cd\s+\S+\s*(&&|;)\s*')
RX_ENV=re.compile(r'^(\w+=\S+\s+)+')
def shape(cmd):
    c=cmd.strip()
    c=RX_CD.sub('',c); c=RX_ENV.sub('',c)
    c=re.sub(r'^(rtk|timeout\s+\d+)\s+','',c)
    c=re.sub(r'^(rtk|timeout\s+\d+)\s+','',c)
    toks=c.split()
    if not toks: return ''
    h=toks[0]
    out=[h]
    for t in toks[1:3]:
        if t.startswith(('-','/','.','"',"'",'$','<','>','|','&',';')) or '/' in t or '.' in t and not t.startswith('test:'): break
        out.append(t)
    return ' '.join(out)[:60]
RX_GT=re.compile(r'gsd-tools(?:\.cjs|\.js)?["\']?\s+([\w:-]+)(?:\s+([\w:-]+))?')
RX_W=re.compile(r'(^|[\s;&|(])(sleep|until|while|ping -c)\s|tail -f|seq 1 \d+\); do')
def wsub(c):
    if re.search(r'stack-lock|local-stack\.lock|owner\.txt',c) and not re.search(r'deno|run-integration',c): return 'lock'
    if re.search(r'tasks/.*\.output|\.output',c): return 'bgtask-output'
    if re.search(r'SUMMARY|REVIEW|VERDICT|RULING|VERIFICATION|PLAN\.md|git log|git rev-parse|\.md\b|agent-a\w+\.jsonl',c): return 'agent-artifact'
    if re.search(r'pgrep|\.exit|\.log|run-integration|deno|test|charlotte|_progress|\.tsv|\.txt|\.json',c): return 'test-or-job'
    return 'blind-sleep'
def process(args):
    path,proj,kind=args
    shapes=collections.defaultdict(lambda:[0,0.0])
    skills=collections.Counter(); slash=collections.Counter(); gt=collections.Counter()
    reps=collections.Counter(); tu={}
    bgb=0; mon=0; wf=collections.Counter()
    cron=collections.Counter(); waits=collections.defaultdict(lambda:[0,0.0])
    with open(path,'r',errors='replace') as f:
        for line in f:
            if line.startswith('{"type":'): continue
            if '"name":"Skill"' in line or '"name":"Bash"' in line or '"tool_use_id"' in line or '<command-name>' in line:
                pass
            else: continue
            try: d=json.loads(line)
            except Exception: continue
            t=d.get('type'); ts=d.get('timestamp')
            if not ts: continue
            msg=d.get('message') or {}; c=msg.get('content')
            if t=='assistant' and isinstance(c,list):
                for b in c:
                    if b.get('type')!='tool_use': continue
                    nm=b.get('name'); inp=b.get('input') if isinstance(b.get('input'),dict) else {}
                    if nm=='Skill': skills[str(inp.get('skill'))]+=1
                    elif nm=='Bash':
                        cmd=str(inp.get('command') or '')
                        sh=shape(cmd)
                        tu[b['id']]=(ep(ts),sh,cmd,(wsub(cmd) if RX_W.search(cmd) and not re.search(r'deno (task )?test|run-integration|preflight',cmd) else None))
                        if inp.get('run_in_background'): bgb+=1
                        m=RX_GT.search(cmd)
                        if m: gt[(m.group(1)+' '+(m.group(2) or '')).strip()]+=1
                        if re.search(r'(deno (task )?test|nx test|mutant|run-integration|preflight)',cmd):
                            reps[re.sub(r'\s+',' ',cmd.strip())[:240]]+=1
                    elif nm in('Monitor',): mon+=1
                    elif nm in('CronCreate',): cron['create']+=1
            elif t=='user':
                if isinstance(c,str):
                    for m in re.finditer(r'<command-name>(/?[\w:-]+)</command-name>',c): slash[m.group(1)]+=1
                elif isinstance(c,list):
                    for b in c:
                        if b.get('type')=='text':
                            for m in re.finditer(r'<command-name>(/?[\w:-]+)</command-name>',b.get('text','')): slash[m.group(1)]+=1
                        if b.get('type')=='tool_result':
                            x=tu.pop(b.get('tool_use_id'),None)
                            if x:
                                s=shapes[x[1]]; s[0]+=1; s[1]+=ep(ts)-x[0]
                                if x[3]: w=waits[x[3]]; w[0]+=1; w[1]+=ep(ts)-x[0]
    return {'path':path,'shapes':dict(shapes),'skills':dict(skills),'slash':dict(slash),'gt':dict(gt),'reps':{k:v for k,v in reps.items() if v>1},'bgb':bgb,'mon':mon,'waits':dict(waits)}
def main():
    jobs=[]
    for proj in PROJ:
        d=BASE+proj
        for p in glob.glob(d+'/*.jsonl'): jobs.append((p,proj,'top'))
        for p in glob.glob(d+'/*/subagents/*.jsonl'): jobs.append((p,proj,'sub'))
    jobs.sort(key=lambda j:-os.path.getsize(j[0]))
    with Pool(4) as pool, open('out/scan2.jsonl','w') as out:
        for r in pool.imap_unordered(process,jobs,chunksize=1): out.write(json.dumps(r)+'\n')
if __name__=='__main__': main()
