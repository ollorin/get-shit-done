import json,glob,sys
n=sys.argv[1]
sid=None
for l in open(n+'.stream.jsonl'):
    x=json.loads(l)
    if x.get('subtype')=='init': sid=x['session_id'];break
for f in glob.glob(f'/Users/ollorin/.claude/projects/-Users-ollorin-ab-eval-scratch-h100k-p/{sid}/subagents/*.jsonl'):
    seen=set();ctx=[];nb=[]
    last=None
    for l in open(f):
        x=json.loads(l)
        if x.get('type')=='system' and 'compact' in str(x.get('subtype')): nb.append(x['compactMetadata']['preTokens'])
        if x.get('type')=='assistant':
            m=x['message']
            for b in m.get('content',[]):
                if b.get('type')=='text': last=b['text']
            if m['id'] in seen or not m.get('usage'): continue
            seen.add(m['id']);u=m['usage'];ctx.append(u['input_tokens']+u.get('cache_creation_input_tokens',0)+u.get('cache_read_input_tokens',0))
    print(n,'calls',len(ctx),'max',max(ctx),'compactions at',nb,'| final:',(last or '')[:160].replace('\n',' '))
