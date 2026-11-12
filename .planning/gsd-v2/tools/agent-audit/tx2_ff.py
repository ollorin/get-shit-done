from tx2_d import *
S=[(p,v) for p,v in ALL.items() if v[0]=='gsd-verifier']
c=collections.Counter(); st=collections.Counter()
for p,(rr,calls,order,res,final) in S:
    f=final or ''
    W=' '.join(calls[i][1].get('command','')+calls[i][1].get('content','') for i in order if calls[i][0] in('Bash','Write'))
    V=bool(re.search(r'VERIFICATION\.md',W))
    c['n']+=1; c['touches VERIFICATION.md']+=V
    wrote=bool(re.search(r'(cat|tee)[^\n]*VERIFICATION\.md|VERIFICATION\.md[^\n]*<<',W)) or bool(re.search(r"<<'?EOF'?[\s\S]{0,200}status:",W))
    c['writes_report_frontmatter']+=bool(re.search(r'score:\s*\d+/\d+',W))
    c['failure_type']+=('failure_type' in W)
    c['charlotte_qa_ran']+=('charlotte_qa_ran' in W)
    c['re_verification block']+=('re_verification:' in W)
    c['PRD Intent']+=('PRD Intent' in W or 'PRD-TRACE' in W)
    c['Anti-Patterns section']+=('Anti-Patterns Found' in W)
    c['Human Verification section']+=('human_verification' in W or 'Human Verification Required' in W)
    c['key link']+=bool(re.search(r'Key Link',W))
    c['Observable Truths']+=('Observable Truths' in W)
    c['Step8b test suite']+=bool(re.search(r'deno (task )?test|nx test|vitest|run-integration|test:ci',W))
    c['regression sweep (prior phases)']+=bool(re.search(r'regression',W+f,re.I))
    c['semantic stub/done-criteria']+=bool(re.search(r'semantic|done[- ]criteria|<done>',W+f,re.I))
    m=re.search(r'\b(passed|gaps_found|human_needed)\b',f)
    st[m.group(1) if m else '-']+=1
print(dict(c)); print(st)
