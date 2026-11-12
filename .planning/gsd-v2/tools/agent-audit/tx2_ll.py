from tx2_d import *
PR=pickle.load(open('tx2_prompts.pkl','rb'))
S=[(p,v) for p,v in ALL.items() if v[0]=='gsd-test-writer']
c=collections.Counter()
for p,(rr,calls,order,res,final) in S:
    B=' '.join(calls[i][1].get('command','') for i in order if calls[i][0]=='Bash')
    E=[calls[i][1].get('file_path','') for i in order if calls[i][0] in('Edit','Write')]
    c['sed_i']+=('sed -i' in B); c['worktree_any']+=('worktree' in B); c['mutant_word_in_cmds']+=bool(re.search(r'mutant|mutation|mut-',B,re.I))
    c['prompt_mutation']+=bool(re.search(r'mutat',PR.get(p,''),re.I))
    c['edits_nontest_src']+=any(not re.search(r'\.test\.|__tests__|\.planning|\.tmp|fixtures|helpers',x) for x in E)
    c['git_commit']+=bool(re.search(r'git (-C \S+ )?commit',B))
    c['REUSE/inventory zg']+=bool(re.search(r'zg query|git grep',B))
print(dict(c))
