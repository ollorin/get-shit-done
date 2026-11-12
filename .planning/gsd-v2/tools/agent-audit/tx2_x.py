from tx2_d import *
PR=pickle.load(open('tx2_prompts.pkl','rb'))
S=[(p,v) for p,v in ALL.items() if v[0]=='gsd-charlotte-qa']
c=collections.Counter(); tc=collections.Counter()
for p,(rr,calls,order,res,final) in S:
    f=final or ''; pr=PR.get(p,''); r=P[p]
    c['n']+=1
    mode=re.search(r'mode[`:\s=*"]+\s*(ui-qa|ux-audit|e2e)',pr,re.I)
    c['mode:'+(mode.group(1).lower() if mode else ('e2e?' if re.search(r'e2e|scenario',pr,re.I) else 'none'))]+=1
    c['json_result']+=bool(re.search(r'"issue_count"|"severity_counts"',f))
    c['report_markdown_key']+=('report_markdown' in f)
    c['QA Report hdr']+=bool(re.search(r'QA Report',f))
    c['prompt:round']+=bool(re.search(r'round',pr,re.I))
    c['mcp_tool_calls>0']+=any(calls[i][0].startswith('mcp__charlotte') for i in order)
    c['no_mcp_calls']+=not any(calls[i][0].startswith('mcp__charlotte') for i in order)
    c['screenshot_calls']+=any('screenshot' in calls[i][0] for i in order)
    c['deno task test:scenario / runner']+=any('test:scenario' in calls[i][1].get('command','') or 'e2e-charlotte' in calls[i][1].get('command','') for i in order if calls[i][0]=='Bash')
    c['service-health']+=any('service-health' in calls[i][1].get('command','') for i in order if calls[i][0]=='Bash')
    c['stack-lock']+=any('stack-lock' in calls[i][1].get('command','') for i in order if calls[i][0]=='Bash')
    c['spawn']+=any(calls[i][0] in('Agent','Task','SendMessage') for i in order)
    c['model_'+lib.model(r)]+=1
    for i in order: tc[calls[i][0].replace('mcp__charlotte__charlotte_','C:')]+=1
print(dict(c)); print(tc.most_common(20))
B=collections.Counter()
for p,(rr,calls,order,res,final) in S:
    for i in order:
        if calls[i][0]=='Bash':
            cm=re.sub(r'^cd \S+ *(&&|;) *','',calls[i][1].get('command','').strip()); B[' '.join(cm.split()[:3])[:45]]+=1
print(B.most_common(18))
for p,(rr,calls,order,res,final) in S[:28]:
    print(os.path.basename(p)[:16],lib.model(P[p])[:6],(P[p]['meta'].get('description') or '')[:45],'|',(final or '')[:110].replace('\n',' '))
