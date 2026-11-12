from common import *
S=rs('gsd-executor')
sm=[(r,e[2]) for r in S for e in P[r['path']] if e[0]=='tu' and e[1]=='SendMessage']
print(len(sm),collections.Counter(('main' if i['to']=='main' else 'agentid' if re.match(r'^a[0-9a-f]{10,}',i['to']) else i['to'][:20]) for _,i in sm).most_common(6))
import random; random.seed(7)
for r,i in random.sample(sm,10): print(bn(r)[:16],i['to'][:20],'|',i['msg'][:160].replace('\n',' '))
# deviation tags
tags=collections.Counter(); n=0
for r in S:
    txt=' '.join(str(e[2]) for e in P[r['path']] if e[0]=='tu' and e[1] in('Write','Edit'))+' '.join(e[1] for e in P[r['path']] if e[0]=='text')
    f=set(re.findall(r'\[Rule (\d)',txt))
    for x in f: tags[x]+=1
    if f: n+=1
print('transcripts with [Rule N] tag',n,tags)
# time-wait via Monitor + sleep: ok. 'df -h' before heavy runs
df=sum(any(e[0]=='tu' and e[1]=='Bash' and 'df -h' in e[2]['cmd'] for e in P[r['path']]) for r in S)
heavy=sum(any(e[0]=='tu' and e[1]=='Bash' and re.search(r'run-integration|supabase db reset|preflight|nx build',e[2]['cmd']) for e in P[r['path']]) for r in S)
dfh=sum(any(e[0]=='tu' and e[1]=='Bash' and 'df -h' in e[2]['cmd'] for e in P[r['path']]) and any(e[0]=='tu' and e[1]=='Bash' and re.search(r'run-integration|supabase db reset|preflight|nx build',e[2]['cmd']) for e in P[r['path']]) for r in S)
print('executors with heavy run',heavy,'of which did df -h',dfh,'df anywhere',df)
# inline env var test commands
inl=sum(1 for r in S for e in P[r['path']] if e[0]=='tu' and e[1]=='Bash' and re.match(r'\s*(cd [^;&]+&&\s*)?[A-Z_]+=\S+\s+(deno|npx|node)',e[2]['cmd']))
print('bash cmds with inline env prefix before deno/npx',inl)
pipe=sum(1 for r in S for e in P[r['path']] if e[0]=='tu' and e[1]=='Bash' and re.search(r'deno (task )?test[^\n|]*\|\s*(tail|grep|head)',e[2]['cmd']))
print('deno test piped to tail/grep/head',pipe)
newscript=sum(1 for r in S for e in P[r['path']] if e[0]=='tu' and e[1]=='Write' and re.match(r'.*/(scripts|apps/[^/]+/scripts)/[^/]+\.(ts|sh|py)$',e[2].get('p') or ''))
print('Write of new file under scripts/',newscript)
