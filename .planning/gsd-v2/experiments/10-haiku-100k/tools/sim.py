import json,time
src='/Users/ollorin/igaming-platform/.tmp/gsd-v2/out/files.jsonl'
rows=[];tmax=0
for l in open(src):
    x=json.loads(l); tmax=max(tmax,x.get('t1') or 0)
    if x['kind']!='sub' or x['meta'].get('agentType')!='gsd-executor' or x['meta'].get('model')!='haiku' or 'claude-haiku-5-5' not in x['tok']: continue
    rows.append(x)
rows=[r for r in rows if r['t0']>=tmax-21*86400 and r.get('series')]
BASE=38000
def cost_call(ctx,g,out,m): return m*(ctx*0.01+g*0.125+out*0.5)/1e6
def sim(mode,P):
    tot=0;ab=0;n=0;spawns_over=0
    for r in rows:
        ser=[s[0] for s in r['series']]
        o=r['tok']['claude-haiku-5-5'][4]/max(len(ser),1)
        d=[max(ser[i]-ser[i-1],0) for i in range(1,len(ser))]
        ctx=ser[0]; prev=0;g=ser[0]-BASE if False else 0
        cnt_since=0;over=False
        for i in range(len(ser)):
            if i>0: ctx+=d[i-1]
            gi=d[i-1] if i>0 else ser[0]
            if mode=='compact' and ctx>=P:
                tot+= 0.007; ctx=BASE+26000; gi=BASE+26000   # compaction call cost + cache rewrite of the new prefix
            if mode=='split' and cnt_since>=P:
                ctx=BASE+8000; gi=BASE+8000; cnt_since=0
            cnt_since+=1
            m=5 if ctx>100000 else 1
            tot+=cost_call(ctx,gi,o,m); n+=1; ab+= ctx>100000
    return tot,ab/n,n
base=sim('none',0)
print('spawns',len(rows),'calls',base[2])
print('as-is      cost $%.1f  share>100k %.3f'%(base[0],base[1]))
for T in(97000,150000,317000):
    c=sim('compact',T);print('compact@%d cost $%.1f (%.2fx) share>100k %.3f'%(T,c[0],c[0]/base[0],c[1]))
for K in(15,25,35,50):
    c=sim('split',K);print('split every %d calls cost $%.1f (%.2fx) share>100k %.3f  (handoff overhead excluded)'%(K,c[0],c[0]/base[0],c[1]))
import statistics as st
nc=[len(r['series']) for r in rows]
print('calls/spawn median',st.median(nc),'p25',sorted(nc)[len(nc)//4],'p75',sorted(nc)[3*len(nc)//4],'share spawns >35 calls',sum(1 for c in nc if c>35)/len(nc))
