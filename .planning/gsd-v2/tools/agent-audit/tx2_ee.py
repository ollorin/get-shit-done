from tx2_d import *
PR=pickle.load(open('tx2_prompts.pkl','rb'))
S=[(p,v) for p,v in ALL.items() if v[0]=='gsd-plan-checker']
c=collections.Counter()
for p,(rr,calls,order,res,final) in S:
    f=final or ''
    W=' '.join(calls[i][1].get('command','')+calls[i][1].get('content','') for i in order if calls[i][0] in('Bash','Write'))
    c['n']+=1
    c['final_sev_BHML']+=bool(re.search(r'\b(BLOCKER|HIGH|MED(IUM)?|LOW)\b',f))
    c['final_sev_blocker/warning/info']+=bool(re.search(r'\bwarning\b|\binfo\b',f,re.I) and re.search(r'blocker',f,re.I))
    c['written_report_dimension_field']+=bool(re.search(r'dimension:',W)) 
    c['written_report_has_fix_hint']+=('fix_hint' in W)
    c['prompt_sev_BHML']+=bool(re.search(r'BLOCKER|HIGH',PR.get(p,'')))
    c['wrote_report_file']+=bool(re.search(r'cat >|tee |Write',W)) or any(calls[i][0]=='Write' for i in order)
    c['report_in_PLAN-CHECK_name']+=bool(re.search(r'PLAN-CHECK|CHECK-PLANS|REVIEW',W))
    c['gsd_tools_verify_plan_structure']+=('plan-structure' in W)
    c['gsd_tools_any']+=('gsd-tools' in W)
    c['nyquist/VALIDATION mention in report']+=bool(re.search(r'VALIDATION\.md|nyquist',W+f,re.I))
    c['tdd/testing mandate']+=bool(re.search(r'tdd="true"|tdd=|checkpoint:ui-qa|deferral',W+f,re.I))
    c['context compliance (locked decision)']+=bool(re.search(r'locked decision|CONTEXT\.md',W+f,re.I))
    c['LOC/500 sizing']+=bool(re.search(r'500[- ]LOC|\b500 lines|module-structure',W+f,re.I))
    c['fix_plans_itself']+=bool(re.search(r"sed -i|python3.*\.write\(|write_text|perl -i",W)) or any(calls[i][0]=='Edit' for i in order)
    c['committed']+=bool(re.search(r'git (-C \S+ )?commit',W))
print(dict(c))
