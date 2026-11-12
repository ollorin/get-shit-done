import json,glob,os,collections,datetime
base=os.path.expanduser('~/.claude/projects/')
c=collections.Counter(); mt=collections.defaultdict(list)
for proj in ['<project-slug>','<project-slug>-apps-e2e-charlotte']:
    for p in glob.glob(base+proj+'/*/subagents/*.meta.json'):
        try: m=json.load(open(p))
        except Exception as e: continue
        k=(proj[-8:],m.get('agentType'),m.get('model'))
        c[k]+=1
        mt[k].append(os.path.getmtime(p))
for k,v in sorted(c.items(), key=lambda x:-x[1]):
    ts=mt[k]
    print(v,k,datetime.date.fromtimestamp(min(ts)),datetime.date.fromtimestamp(max(ts)))
