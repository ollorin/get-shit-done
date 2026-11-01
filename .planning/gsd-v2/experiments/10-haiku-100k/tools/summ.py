import json,sys
ids=set();
for l in open(sys.argv[1]):
    try:x=json.loads(l)
    except: continue
    t=x.get('type')
    if t=='assistant':
        m=x['message']
        if m['id'] in ids: continue
        ids.add(m['id']); u=m['usage']
        print('A',u['input_tokens']+u.get('cache_creation_input_tokens',0)+u.get('cache_read_input_tokens',0),'cw',u.get('cache_creation_input_tokens'),'cr',u.get('cache_read_input_tokens'),'out',u['output_tokens'],m['model'])
    elif t=='system' and x.get('subtype') not in('thinking_tokens','task_summary','post_turn_summary','init'): print('S',x.get('subtype'),json.dumps(x)[:300])
    elif t=='result': print('R',x.get('subtype'),round(x.get('total_cost_usd'),4),x.get('num_turns'),str(x.get('result'))[:80].replace('\n',' '))
