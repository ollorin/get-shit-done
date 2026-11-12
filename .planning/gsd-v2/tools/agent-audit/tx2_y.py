from tx2_d import *
PR=pickle.load(open('tx2_prompts.pkl','rb'))
S=[(p,v) for p,v in ALL.items() if v[0]=='reviewer']
c=collections.Counter(); L=[]; usd=[]
dup=['zero tolerance|zero findings','path-trace|file:line','every severity|all severities|each severity','git stash|rebase|reset|clean','read-only|do not edit|never edit|not edit','--no-verify','Result<|neverthrow|never.*throw','co-authored-by','git commit -- |commit only','\\.tmp/','independent|fresh','BLOCKER|HIGH|MEDIUM|LOW']
dc=collections.Counter()
by=collections.defaultdict(list)
for p,(rr,calls,order,res,final) in S:
    f=final or ''; pr=PR.get(p,''); r=P[p]; L.append(len(pr)); usd.append(lib.tokens(r)[4])
    c['n']+=1; c['model_'+lib.model(r)]+=1
    by[lib.model(r)].append((len(pr),lib.tokens(r)[4],r['max_ctx']))
    for d in dup: dc[d]+=bool(re.search(d,pr,re.I))
    B=[calls[i][1].get('command','') for i in order if calls[i][0]=='Bash']
    c['verdict_in_final']+=bool(re.search(r'verdict|APPROVED|CHANGES_REQUIRED|BLOCKED|PASS|FAIL|no findings|zero findings',f,re.I))
    c['sev_in_final']+=bool(re.search(r'BLOCKER|\bHIGH\b|MEDIUM|\bLOW\b',f))
    c['fileline_in_final']+=bool(re.search(r'\w\.\w{1,4}:\d+',f))
    c['wrote_report_file']+=any(calls[i][0]=='Write' or (calls[i][0]=='Bash' and re.search(r'cat >|tee ',calls[i][1].get('command','')) ) for i in order)
    c['ran_tests']+=any(re.search(r'deno (task )?test|nx test|vitest|deno test',b) and not re.match(r'\s*(cat|grep|sed|git|ls)\b',b) for b in B)
    c['git_commit']+=any(re.search(r'git (-C \S+ )?commit',b) for b in B)
    c['edit_src']+=any(calls[i][0]=='Edit' and not re.search(r'\.planning|\.tmp',calls[i][1].get('file_path','')) for i in order)
    c['sed_i']+=any('sed -i' in b for b in B)
    c['mutation_worktree']+=any('git worktree add' in b for b in B)
    c['spawn']+=any(calls[i][0] in('Agent','Task') for i in order)
    c['final_empty']+=(len(f.strip())<40)
    c['final_gt6000']+=(len(f)>6000)
print(dict(c)); print({k:v for k,v in dc.items()})
print('prompt len med',lib.pct(L,50),'p90',lib.pct(L,90),'usd sum',round(sum(usd)),'avg',round(sum(usd)/len(usd),2))
for m,v in by.items(): print(m,len(v),'avg prompt',sum(x[0] for x in v)//len(v),'avg usd',round(sum(x[1] for x in v)/len(v),2),'avg ctx',sum(x[2] for x in v)//len(v))
# description groups
print(collections.Counter(re.sub(r'\d+(\.\d+)?(-\d+)?','N',(P[p]['meta'].get('description') or '').lower())[:28] for p,_ in S).most_common(12))
