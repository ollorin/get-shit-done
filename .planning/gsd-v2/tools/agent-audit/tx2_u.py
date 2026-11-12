from tx2_d import *
PR=pickle.load(open('tx2_prompts.pkl','rb'))
S=[(p,v) for p,v in ALL.items() if v[0]=='gsd-docs-updater']
c=collections.Counter(); ed=[]; ex=[]
scope=collections.Counter(); costs=[]
for p,(rr,calls,order,res,final) in S:
    f=final or ''
    r=P[p]
    c['n']+=1
    c['has_hdr']+=('## Docs Update Result' in f)
    c['written_files_field']+=bool(re.search(r'written_files',f))
    c['commit_field']+=bool(re.search(r'\bcommit:',f))
    c['errors_field']+=bool(re.search(r'\berrors:',f))
    c['all3']+=all(re.search(k,f) for k in['written_files',r'\bcommit:',r'\berrors:'])
    c['empty_written']+=bool(re.search(r'written_files:\s*\[\s*\]',f))
    c['nodocs_phrase']+=bool(re.search(r'no docs? (update )?(needed|required|change)|nothing to (document|update)|no documentation',f,re.I))
    ne=sum(1 for i in order if calls[i][0]=='Edit'); nw=sum(1 for i in order if calls[i][0]=='Write')
    ed.append(ne+nw)
    c['zero_edits']+=(ne+nw==0)
    B=[calls[i][1].get('command','') for i in order if calls[i][0]=='Bash']
    c['git_commit']+=any(re.search(r'git (-C \S+ )?commit',b) for b in B)
    c['claude_md_read']+=any(calls[i][0]=='Read' and re.search(r'CLAUDE\.md|\.claude/rules',calls[i][1].get('file_path','')) for i in order)
    c['reads_summary']+=any(calls[i][0]=='Read' and 'SUMMARY' in calls[i][1].get('file_path','') for i in order)
    c['bash_only_git/ls']+=1 if B and all(re.match(r'\s*(cd \S+ && )?(rtk )?(git|ls|zg|cat|sed|grep|head|wc|test|stat)',b) for b in B) else 0
    c['lsp']+=any(calls[i][0]=='LSP' for i in order)
    c['spawn']+=any(calls[i][0] in('Agent','Task') for i in order)
    c['grep_glob_tool']+=any(calls[i][0] in('Grep','Glob') for i in order)
    c['model_'+lib.model(r)]+=1
    c['prompt_has_docs_conv']+=bool(re.search(r'docs/',PR.get(p,'')))
    m=re.search(r'Build scope:\*\*\s*(\w+)',f); scope[m.group(1) if m else '-']+=1
    costs.append(lib.tokens(r)[4])
print(dict(c)); print('avg edits+writes',sum(ed)/len(ed),'median',lib.pct(ed,50),'max',max(ed)); print(scope); print('avg usd',sum(costs)/len(costs),'total',sum(costs))
tc=collections.Counter()
for p,(rr,calls,order,res,final) in S:
    for i in order: tc[calls[i][0]]+=1
print(tc)
nf=[(os.path.basename(p),(v[4] or '')[:160].replace('\n',' ')) for p,v in S if not re.search('Docs Update Result',v[4] or '')]
for x in nf[:8]: print(x)
