from tx2_d import *
PR=pickle.load(open('tx2_prompts.pkl','rb'))
S=[(p,v) for p,v in ALL.items() if v[0]=='gsd-debugger']
c=collections.Counter()
for p,(rr,calls,order,res,final) in S:
    f=final or ''; pr=PR.get(p,''); r=P[p]
    c['n']+=1
    c['hdr_RCF']+=('## ROOT CAUSE FOUND' in f); c['hdr_DC']+=('## DEBUG COMPLETE' in f); c['hdr_INC']+=('INVESTIGATION INCONCLUSIVE' in f); c['hdr_CP']+=('CHECKPOINT REACHED' in f)
    c['json_trailer']+=bool(re.search(r'"status":\s*"(root_cause_found|debug_complete|inconclusive|checkpoint)"',f))
    c['any_hdr']+=bool(re.search(r'## (ROOT CAUSE FOUND|DEBUG COMPLETE|INVESTIGATION INCONCLUSIVE|CHECKPOINT REACHED)',f))
    c['telemetry']+=('context_pressure' in f)
    c['prompt:find_root_cause_only']+=bool(re.search(r'find_root_cause_only|root.cause only|do not fix|don.t fix|diagnos',pr,re.I))
    c['prompt:symptoms_prefilled']+=('symptoms_prefilled' in pr)
    c['prompt:interactive_false']+=bool(re.search(r'interactive:\s*false',pr))
    c['prompt:goal:']+=bool(re.search(r'goal:',pr))
    c['prompt:files_to_read']+=('<files_to_read>' in pr)
    c['prompt_mentions_.planning/debug']+=('.planning/debug' in pr)
    # debug file writes
    w=[calls[i][1].get('file_path','') for i in order if calls[i][0] in('Write','Edit')]
    B=[calls[i][1].get('command','') for i in order if calls[i][0]=='Bash']
    c['debug_file_written']+=any('.planning/debug' in x for x in w) or any('.planning/debug' in b and re.search(r'cat >|tee|>>',b) for b in B)
    c['wrote_src_edits']+=any(not re.search(r'\.planning|\.tmp',x) for x in w)
    c['git_commit']+=any(re.search(r'git (-C \S+ )?commit',b) for b in B)
    c['spawn']+=any(calls[i][0] in('Agent','Task') for i in order)
    c['websearch']+=any(calls[i][0]=='WebSearch' for i in order)
    c['LSP']+=any(calls[i][0]=='LSP' for i in order)
    c['ran_tests']+=any(re.search(r'deno (task )?test|nx test|vitest',b) for b in B)
    c['final_empty/apierr']+=(not f.strip() or f.startswith('API Error'))
    c['claims_fixed']+=bool(re.search(r'fixed|fix applied|DEBUG COMPLETE',f,re.I))
print(dict(c))
print(collections.Counter(re.sub(r'\d+','N',(P[p]['meta'].get('description') or '')[:35]) for p,_ in S).most_common(10))
