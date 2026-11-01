import json,time,statistics as st,collections
src='/Users/ollorin/igaming-platform/.tmp/gsd-v2/out/files.jsonl'
rows=[];tmax=0
for l in open(src):
    x=json.loads(l); tmax=max(tmax,x.get('t1') or 0)
    if x['kind']!='sub' or x['meta'].get('agentType')!='gsd-executor' or x['meta'].get('model')!='haiku' or 'claude-haiku-5-5' not in x['tok']: continue
    rows.append(x)
rows=[r for r in rows if r['t0']>=tmax-21*86400 and r.get('series')]
P=dict(i=0.10,cw=0.125,cr=0.01,o=0.50)
def tcost(r):
    n,inp,cw,cr,o=r['tok']['claude-haiku-5-5']
    ser=[s[0] for s in r['series']];tot=sum(ser) or 1
    ab=sum(c for c in ser if c>100000)/tot;nab=sum(1 for c in ser if c>100000)/len(ser)
    base=(inp*P['i']+cw*P['cw']+cr*P['cr'])/1e6;out=o*P['o']/1e6
    return base*(1-ab)+out*(1-nab)+5*(base*ab+out*nab)
rows.sort(key=lambda r:-tcost(r))
top=rows[:20]
grp=collections.Counter();tot=0
for r in top:
    cat=r['cat'].items() if isinstance(r['cat'],dict) else r['cat']
    for k,v in cat:
        g=k.split(':')[0]
        if k.startswith('bash:search') : g='bash:search'
        elif k.startswith('bash:file-inspect'): g='bash:file-inspect'
        elif k.startswith('bash:integration') or k.startswith('bash:test') or k.startswith('bash:mutation') or k.startswith('bash:gates'): g='bash:test/gates/mutation'
        elif k.startswith('bash:'): g='bash:other'
        elif k.startswith('read:planning'): g='read:planning-docs'
        elif k.startswith('read:'): g='read:code/test'
        grp[g]+=v[3];tot+=v[3]
print('top20 cost share', sum(tcost(r) for r in top)/sum(tcost(r) for r in rows))
print('new-content tokens (cache-write) by tool category, top20:')
for g,v in grp.most_common(): print('  ',g,round(v/1e3),'k tok',round(100*v/tot,1),'%')
f=lambda a:st.median(a)
print('calls med',f([len(r['series']) for r in top]),'max_ctx med',f([r['max_ctx'] for r in top]))
print('first-turn med',f([r['first_turn'][2]+r['first_turn'][3] for r in top]))
print('instr chars med',f([sum(v for k,v in r['instr']) for r in top]),'(~tok',f([sum(v for k,v in r['instr']) for r in top])//4,')')
print('nested rule chars med',f([sum(x[1] for x in r['nested']) for r in top]))
print('Read result chars med',f([r['tool_res_chars'].get('Read',[0,0])[1] for r in top]),'Bash',f([r['tool_res_chars'].get('Bash',[0,0])[1] for r in top]))
print('first_prompt chars med',f([len(r.get('first_prompt','')) for r in top]))
print('spawns w/ compact boundary',sum(1 for r in top if r.get('api_errors',{}).get('compact_boundary')),'of 20; max_ctx>=288k',sum(1 for r in top if r['max_ctx']>=288000))
allg=[ (r['max_ctx']) for r in rows]
print('all 349: share peaking 288k-330k',sum(1 for m in allg if 288000<=m<=330000)/len(allg))
gr=[]
for r in rows:
    s=[x[0] for x in r['series']]
    gr+= [max(s[i]-s[i-1],0) for i in range(1,len(s)) if s[i]>s[i-1]]
print('median per-call growth tok',st.median(gr),'mean',round(st.mean(gr)))
print('descs',[ (r['meta'].get('description') or '')[:28] for r in top])
