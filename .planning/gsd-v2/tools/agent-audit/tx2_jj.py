from tx2_d import *
import glob
PR=pickle.load(open('tx2_prompts.pkl','rb'))
docs=''
for f in ['<project-root>/CLAUDE.md']+glob.glob('<project-root>/.claude/rules/*.md'):
    docs+=open(f).read()+'\n'
def sh(t,n=6):
    w=re.findall(r'\w+',t.lower()); return set(tuple(w[i:i+n]) for i in range(len(w)-n+1))
D=sh(docs)
def ov(t):
    s=sh(t); return len(s&D)/max(len(s),1)
out={}
for ro,sub in [('reviewer-true',None),('gsd-verifier',None),('gsd-plan-checker',None),('gsd-test-writer',None),('gsd-debugger',None),('gsd-docs-updater',None)]:
    if ro=='reviewer-true': S=[p for p,v in ALL.items() if v[0]=='reviewer' and not re.search(r'\bfix',P[p]['meta'].get('description','') or '',re.I)]
    else: S=[p for p,v in ALL.items() if v[0]==ro]
    o=[ov(PR.get(p,'')) for p in S]; L=[len(PR.get(p,'')) for p in S]
    dup_chars=[ov(PR.get(p,''))*len(PR.get(p,'')) for p in S]
    print(ro,len(S),'prompt med chars',lib.pct(L,50),'p90',lib.pct(L,90),'6-gram overlap w/ CLAUDE.md+rules: med %.2f'%lib.pct(o,50),'p90 %.2f'%lib.pct(o,90),'est dup chars med',int(lib.pct(dup_chars,50)))
# reviewers true: other
S=[(p,v) for p,v in ALL.items() if v[0]=='reviewer' and not re.search(r'\bfix',P[p]['meta'].get('description','') or '',re.I)]
c=collections.Counter()
for p,(rr,calls,order,res,final) in S:
    f=final or ''
    c['model_'+lib.model(P[p])]+=1
    B=[calls[i][1].get('command','') for i in order if calls[i][0]=='Bash']
    c['edit_src']+=any(calls[i][0]=='Edit' and not re.search(r'\.planning|\.tmp',calls[i][1].get('file_path','')) for i in order)
    c['sed_i']+=any('sed -i' in b for b in B)
    c['mutation_worktree']+=any('git worktree add' in b for b in B)
    c['ran_tests']+=any(re.search(r'deno (task )?test|nx test|vitest|deno test',b) and not re.match(r'\s*(cat|grep|sed|git|ls)\b',b) for b in B)
    c['verdict']+=bool(re.search(r'verdict|APPROVED|CHANGES|BLOCKED|no findings|zero findings|0 findings',f,re.I))
    c['sev']+=bool(re.search(r'BLOCKER|\bHIGH\b|MEDIUM|\bLOW\b',f))
    c['fileline']+=bool(re.search(r'\w\.\w{1,4}:\d+',f))
    c['zero_findings_claim']+=bool(re.search(r'zero findings|0 findings|no findings|no BLOCKER',f,re.I))
    c['wrote_review_file']+=any(calls[i][0]=='Write' for i in order) or any(re.search(r'cat >',b) for b in B)
    c['git_commit']+=any(re.search(r'git (-C \S+ )?commit',b) for b in B)
    c['n']+=1
print(dict(c))
