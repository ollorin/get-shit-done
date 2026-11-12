from tx2_d import *
PR=pickle.load(open('tx2_prompts.pkl','rb'))
def bashes(calls,order): return [calls[i][1].get('command','') for i in order if calls[i][0]=='Bash']
for ro in ['gsd-verifier','gsd-plan-checker']:
    n=0;c=collections.Counter()
    for p,(rr,calls,order,res,final) in ALL.items():
        if rr!=ro: continue
        n+=1; f=final or ''; B=bashes(calls,order)
        diffrev=bool(re.search(r'diff review|diff-review|re-review|sonnet.*review|opus review',P[p]['meta'].get('description','') or '',re.I))
        c['diffreview-labelled']+=diffrev
        c['json_trailer']+=bool(re.search(r'```json\s*\{\s*"status"',f))
        c['telemetry_line']+=('Telemetry' in f or 'context_pressure' in f)
        c['git_commit']+=any(re.search(r'git (-C \S+ )?commit',b) for b in B)
        c['prompt_says_commit']+=bool(re.search(r'commit',PR.get(p,''),re.I))
        c['gsd_tools_eval_candidate']+=any('eval-candidate' in b for b in B)
        c['gsd_tools_any']+=any('gsd-tools' in b for b in B)
        c['sed_i_or_edit_src']+=any(re.search(r"sed -i",b) for b in B)
        c['worktree_add']+=any('git worktree add' in b for b in B)
        c['runs_tests']+=any(TEST.search(b) for b in B)
        c['Edit/Write tool']+=any(calls[i][0] in('Edit','Write') for i in order)
        c['spawn']+=any(calls[i][0] in('Agent','Task') for i in order)
        c['gsd-tools verify']+=any(re.search(r'gsd-tools.*verify',b) for b in B)
        c['final_empty']+=(len(f.strip())<40)
        c['final_nowrite_mention']+=0
    print(ro,n,dict(c))
