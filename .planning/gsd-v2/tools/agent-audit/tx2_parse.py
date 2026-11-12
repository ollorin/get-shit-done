from tx2_base import *
import re,pickle,os
def parse(r):
    calls={}  # id->(name,input)
    order=[]; res={}
    final=None
    for e in events(r['path']):
        m=e.get('message')
        if not isinstance(m,dict): continue
        c=m.get('content')
        if e.get('type')=='assistant' and isinstance(c,list):
            for b in c:
                if b.get('type')=='tool_use':
                    calls[b['id']]=(b['name'],b.get('input',{})); order.append(b['id'])
                elif b.get('type')=='text' and b.get('text','').strip(): final=b['text']
        elif e.get('type')=='user' and isinstance(c,list):
            for b in c:
                if b.get('type')=='tool_result':
                    x=b.get('content')
                    if isinstance(x,list): x=' '.join(y.get('text','') for y in x if isinstance(y,dict))
                    res[b.get('tool_use_id')]=x or ''
    return calls,order,res,final
def norm(cmd):
    cmd=re.sub(r'\s+',' ',cmd.strip())
    return cmd[:160]
