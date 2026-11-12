from common import *
import sys
role=sys.argv[1]
S=rs(role)
cat=collections.Counter(); chars=collections.Counter(); paths=collections.Counter(); pch=collections.Counter(); unb=0; nread=0
def pc(p):
    p=p or ''
    if '/.planning/' in p: 
        for k in ['PLAN.md','SUMMARY.md','RESEARCH','CONTEXT','VERIFICATION','FINDINGS','STATE.md','ROADMAP','REQUIREMENTS','CHECKPOINT','DEFERRED','evidence']:
            if k in p: return '.planning:'+k
        return '.planning:other'
    if '/.claude/' in p or '/get-shit-done/' in p: return 'gsd/.claude refs'
    if '__tests__' in p or '.test.' in p: return 'test file'
    if p.endswith(('.log','.output','.txt','.tsv','.json')): return 'log/data'
    if p.endswith('.sql'): return 'migration/sql'
    if p.endswith('.md'): return 'docs md'
    return 'source'
for r in S:
    last=None
    for e in P[r['path']]:
        if e[0]=='tu' and e[1]=='Read': last=e[2]; nread+=1; 
        if e[0]=='tr' and e[1]=='Read' and last is not None:
            if e[2]>=20000:
                k=pc(last.get('p')); cat[k]+=1; chars[k]+=e[2]; paths[last.get('p')]+=1; pch[last.get('p')]+=e[2]
                if not last.get('lim'): unb+=1
            last=None
print(role,'reads',nread,'big reads by class',[(k,v,round(chars[k]/1e6,1)) for k,v in cat.most_common()],'unbounded among big',unb)
print([(k.replace('<project-root>/',''),v,pch[k]//1000) for k,v in paths.most_common(8)])
