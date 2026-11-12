from tx2_d import *
PR=pickle.load(open('tx2_prompts.pkl','rb'))
ST=re.compile(r'deno (task )?test|nx test|vitest run|deno test')
S=[(p,v) for p,v in ALL.items() if v[0]=='gsd-test-writer']
c=collections.Counter()
for p,(rr,calls,order,res,final) in S:
    f=final or ''
    B=[(i,calls[i][1].get('command','')) for i in order if calls[i][0]=='Bash']
    runs=[(i,b) for i,b in B if ST.search(b) and not re.match(r'\s*(cat|grep|sed|git|ls)\b',b)]
    fails=[i for i,b in runs if re.search(r'FAILED|\b[1-9]\d* failed|error: Test failed',res.get(i,''))]
    wr=[k for k,i in enumerate(order) if calls[i][0] in('Write','Edit') and re.search(r'\.test\.',calls[i][1].get('file_path',''))]
    c['n']+=1
    c['ran_tests']+=bool(runs); c['saw_failure']+=bool(fails)
    c['wrote_test_file']+=bool(wr)
    c['wrote_any']+=bool(wr)
    # first run after first test write: fail?
    if wr:
        first=wr[0]; after=[i for i in order[first:] if i in dict(runs)]
        if after:
            c['first_run_after_write']+=1; c['first_run_red']+=bool(re.search(r'FAILED|\b[1-9]\d* failed|error: Test failed',res.get(after[0],'')))
    c['worktree_mut']+=any('git worktree add' in b for i,b in B)
    c['mut_mention_final']+=bool(re.search(r'mutant|mutation|T[012]\b',f))
    c['tests_passing_line']+=bool(re.search(r'passing',f,re.I))
    c['tier_line']+=bool(re.search(r'tier',f,re.I))
    c['telemetry']+=('context_pressure' in f)
    c['FAILURE_0']+=('FAILURE: 0 tests' in f)
    c['spawn']+=any(calls[i][0] in('Agent','Task') for i in order)
    c['reuse_cite']+=bool(re.search(r'REUSE',f))
    c['final_short<200']+=len(f)<200
    c['handback_tool']+=any(calls[i][0]=='SubagentHandback' for i in order)
    c['zg/grep inventory']+=any(re.search(r'zg query|git grep|\bgrep\b|\brg\b',b) for i,b in B)
print(dict(c))
for p,(rr,calls,order,res,final) in S:
    sp=[(calls[i][1].get('subagent_type'),calls[i][1].get('model'),(calls[i][1].get('description') or '')[:50]) for i in order if calls[i][0] in('Agent','Task')]
    if sp: print(os.path.basename(p),sp)
print(collections.Counter(P[p]['meta'].get('description','')[:30] for p,_ in S).most_common(8))
