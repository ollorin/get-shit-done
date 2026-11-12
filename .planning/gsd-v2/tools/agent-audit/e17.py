from common import *
S=rs('gsd-executor')
envrx=re.compile(r'^\s*(cd [^;&]+&&\s*)?([A-Z_]+=\S+\s+)+(deno|npx|node|bash|\./)')
piperx=re.compile(r'deno (task )?test[^\n|]*\|\s*(tail|grep|head|tee)')
c=collections.Counter(); ex={}
for r in S:
    ev=P[r['path']]; pending=[]
    for e in ev:
        if e[0]=='tu': pending.append(e)
        elif e[0]=='tr' and pending:
            tu=pending.pop(0)
            if tu[1]!='Bash': continue
            cmd=tu[2]['cmd']
            for k,rx in [('inline env',envrx),('test piped',piperx)]:
                if rx.search(cmd):
                    c[k]+=1; c[k+' denied/blocked']+= bool(re.search(r'(?i)permission|denied|not allowed|blocked|approval',e[3])) 
                    ex.setdefault(k,(bn(r),cmd[:120]))
print(c,ex)
