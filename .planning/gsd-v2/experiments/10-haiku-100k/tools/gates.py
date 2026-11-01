import json,glob,statistics as st,sys,re
sys.path.insert(0,'/Users/ollorin/ab-eval/scratch/h100k')
import tier
ctl=json.load(open('control_rows.json'))
W=[json.loads(l) for l in open('/Users/ollorin/ab-eval/results/runs-haiku100k.jsonl')]
W=[w for w in W if w['status']=='done' or True]
wa=[tier.analyse(w) for w in W]
def loss_events(run_id):
    ev=[]; 
    for f in sorted(glob.glob(f'/Users/ollorin/ab-eval/runs/{run_id}/transcripts/**/*.jsonl',recursive=True)):
        if 'subagents' not in f: continue
        written={};after=False;last=None;nb=0
        for l in open(f):
            try:x=json.loads(l)
            except:continue
            if x.get('type')=='system' and 'compact' in str(x.get('subtype')): after=True;nb+=1
            if x.get('type')=='assistant':
                for b in x['message'].get('content',[]):
                    if b.get('type')=='tool_use' and b['name']=='Write':
                        p=b['input'].get('file_path')
                        if after and written.get(p): ev.append(f'rewrote {p.split("/")[-1]} after boundary')
                        written[p]=True
                    if b.get('type')=='text': last=b['text']
        if last and re.search(r"paus|not (proceed|make further)|until the user|confirm",last[:600],re.I) and nb: ev.append('final text looks like a stop: '+last[:120].replace('\n',' '))
    return ev
tasks=['E4','E6','E7']
def med(rows,k,t): return st.median([r[k] for r in rows if r['task']==t])
print('TASK  arm  n  acc  commits  compactions  sub_calls  share>100k  peak_med  tier$med  flat$med  wall_med')
for t in tasks:
    for nm,rs in(('A',[c for c in ctl if c['task']==t]),('W',[w for w in wa if w['task']==t])):
        if not rs: continue
        sc=sum(r['sub_calls'] for r in rs);sa=sum(r['sub_above'] for r in rs)
        print(t,nm,len(rs),sum(1 for r in rs if r['acc']),[len(r['commits'] or []) for r in rs],[r['compactions'] for r in rs],sc,round(sa/sc,3),int(st.median([r['peak'] for r in rs])),round(st.median([r['tier'] for r in rs]),3),round(st.median([r['flat'] for r in rs]),3),int(st.median([r['wall'] for r in rs])))
def tot(rows,k): return sum(st.median([r[k] for r in rows if r['task']==t]) for t in tasks if any(r['task']==t for r in rows))
for k in('tier','flat','wall'):
    a,w=tot(ctl,k),tot(wa,k); print('SUM of task medians',k,'A',round(a,3),'W',round(w,3),'ratio',round(w/a,3))
sa=sum(r['sub_above'] for r in wa);sc=sum(r['sub_calls'] for r in wa)
print('W pooled share>100k (executor calls)',round(sa/sc,3),'| A',round(sum(r['sub_above'] for r in ctl)/sum(r['sub_calls'] for r in ctl),3))
print('W compaction extra $ total',round(sum(r['compact_extra'] for r in wa),4))
for w,a in zip(W,wa):
    print(w['run_id'][:30],w['status'],'acc',w['acceptance_pass'],'commits',len(w.get('commits') or []),'loss:',loss_events(w['run_id']))
