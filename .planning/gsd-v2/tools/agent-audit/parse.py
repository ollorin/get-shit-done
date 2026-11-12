import sys; sys.path.insert(0,'<home>/get-shit-done/scripts/gsd-metrics')
import lib, json, pickle, os
from multiprocessing import Pool
def parse(path):
    ev=[]; names={}; 
    try:
        f=open(path)
    except Exception as e: return None
    for i,l in enumerate(f):
        try: d=json.loads(l)
        except: continue
        t=d.get('type')
        if d.get('subtype')=='compact_boundary' or d.get('isCompactSummary'):
            ev.append(('compact',i)); continue
        m=d.get('message')
        if not isinstance(m,dict): continue
        c=m.get('content')
        if t=='assistant' and isinstance(c,list):
            for b in c:
                if b.get('type')=='tool_use':
                    nm=b['name']; inp=b.get('input') or {}
                    names[b['id']]=nm
                    if nm=='Bash': info={'cmd':str(inp.get('command',''))[:600],'desc':str(inp.get('description',''))[:100]}
                    elif nm in('Edit','Write','Read'): info={'p':inp.get('file_path'),'off':inp.get('offset'),'lim':inp.get('limit'),'n':len(str(inp.get('content') or inp.get('new_string') or ''))}
                    elif nm in('Agent','Task'): info={'st':inp.get('subagent_type'),'model':inp.get('model'),'desc':inp.get('description'),'pl':len(str(inp.get('prompt',''))),'prompt':str(inp.get('prompt',''))[:500],'bg':inp.get('run_in_background')}
                    elif nm=='SendMessage': info={'to':str(inp.get('to') or inp.get('recipient'))[:60],'msg':str(inp.get('message') or inp.get('summary') or '')[:300]}
                    elif nm=='SubagentHandback': info={'msg':str(inp.get('message',''))[:400],'len':len(str(inp.get('message','')))}
                    else: info={'inp':str(inp)[:200]}
                    ev.append(('tu',nm,info,i))
                elif b.get('type')=='text':
                    ev.append(('text',b.get('text','')[:1500],i))
        elif t=='user' and isinstance(c,list):
            for b in c:
                if b.get('type')=='tool_result':
                    cc=b.get('content'); 
                    if isinstance(cc,list): s=''.join(x.get('text','') for x in cc if isinstance(x,dict)); 
                    else: s=str(cc)
                    ev.append(('tr',names.get(b.get('tool_use_id'),'?'),len(s),s[:300],i,bool(b.get('is_error'))))
        elif t=='user' and isinstance(c,str):
            ev.append(('user',c[:300],i))
    return ev
def go(r): return (r['path'],parse(r['path']))
if __name__=='__main__':
    R=lib.load()
    rs=[r for r in R if lib.role(r) in('gsd-executor','gsd-phase-coordinator','gsd-planner')]
    with Pool(8) as p: out=dict(p.map(go,rs,chunksize=4))
    pickle.dump(out,open('parsed.pkl','wb'))
    print(len(out))
