import json,glob,os,sys,statistics as st
PR=dict(i=0.10,cw=0.125,cr=0.01,o=0.50)
def price(u,mult): return mult*(u['i']*PR['i']+u['cw']*PR['cw']+u['cr']*PR['cr']+u['o']*PR['o'])/1e6
def run_calls(run_id):
    d=f'/Users/ollorin/ab-eval/runs/{run_id}/transcripts'
    seen=set();calls=[]
    for f in sorted(glob.glob(d+'/**/*.jsonl',recursive=True)):
        sub='subagents' in f
        for l in open(f):
            try:x=json.loads(l)
            except:continue
            if x.get('type')!='assistant':continue
            m=x['message']
            if m['id'] in seen or not m.get('usage'):continue
            seen.add(m['id']);u=m['usage']
            c=dict(i=u.get('input_tokens',0) or 0,cw=u.get('cache_creation_input_tokens',0) or 0,cr=u.get('cache_read_input_tokens',0) or 0,o=u.get('output_tokens',0) or 0)
            calls.append((sub,c['i']+c['cw']+c['cr'],c))
    return calls
def analyse(row):
    calls=run_calls(row['run_id'])
    flat=tier=0;n=0;ab=0;sn=0;sab=0;peak=0
    S=dict(i=0,cw=0,cr=0,o=0)
    for sub,ctx,c in calls:
        flat+=price(c,1);big=ctx>100000
        tier+=price(c,5 if big else 1)
        n+=1;ab+=big
        if sub: sn+=1;sab+=big;peak=max(peak,ctx)
        for k in S:S[k]+=c[k]
    ru=row.get('result_usage') or {}
    try:
        for l in open(f"/Users/ollorin/ab-eval/runs/{row['run_id']}/stream.jsonl"):
            if '"type":"result"' in l:
                mu=json.loads(l).get('modelUsage',{}).get('claude-haiku-5-5')
                if mu: ru={'input_tokens':mu['inputTokens'],'output_tokens':mu['outputTokens'],'cache_creation_input_tokens':mu['cacheCreationInputTokens'],'cache_read_input_tokens':mu['cacheReadInputTokens']}
    except Exception: pass
    extra=dict(i=max((ru.get('input_tokens',0) or 0)-S['i'],0),cw=max((ru.get('cache_creation_input_tokens',0) or 0)-S['cw'],0),cr=max((ru.get('cache_read_input_tokens',0) or 0)-S['cr'],0),o=max((ru.get('output_tokens',0) or 0)-S['o'],0))
    ex=price(extra,1)
    return dict(run=row['run_id'],task=row['task_id'],calls=n,above=ab,sub_calls=sn,sub_above=sab,peak=peak,flat=flat+ex,tier=tier+ex,compact_extra=ex,compactions=row.get('compactions'),wall=row['wall_s'],acc=row['acceptance_pass'],commits=row.get('commits'))
if __name__=='__main__':
    import ab_loader
