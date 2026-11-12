from tx2_d import *
import json
# plan-checker dimension mentions in all text (assistant text, bash cmds, finals)
dims={'D1 Requirement Coverage':r'requirement coverage|dimension 1\b','D2 Task Completeness':r'task completeness|dimension 2\b','D3 Dependency':r'dependency correctness|dimension 3\b','D4 Key Links':r'key links?|dimension 4\b','D5 Scope Sanity':r'scope sanity|dimension 5\b','D6 Verification Derivation':r'verification derivation|dimension 6\b','D7 Context Compliance':r'context compliance|dimension 7\b','D8 Testing Mandate':r'testing mandate|dimension 8\b','D9 Nyquist':r'nyquist|dimension 9\b','D10 File Size':r'file size|routing discipline|dimension 10\b','D11 Logical Cohesion':r'logical cohesion|dimension 11\b','D12 Markdown artifacts':r'artifacts are markdown|dimension 12\b'}
rows=[(p,v) for p,v in ALL.items() if v[0]=='gsd-plan-checker']
cnt=collections.Counter(); cntfinal=collections.Counter()
for p,(ro,calls,order,res,final) in rows:
    # collect assistant text from transcript
    txt=''
    for e in events(p):
        m=e.get('message')
        if e.get('type')=='assistant' and isinstance(m,dict) and isinstance(m.get('content'),list):
            for b in m['content']:
                if b.get('type')=='text': txt+=b['text']+'\n'
                elif b.get('type')=='tool_use' and b['name']=='Bash': txt+=b['input'].get('command','')+'\n'
    for k,pt in dims.items():
        if re.search(pt,txt,re.I): cnt[k]+=1
        if re.search(pt,final or '',re.I): cntfinal[k]+=1
print(len(rows))
for k in dims: print(k,cnt[k],cntfinal[k])
