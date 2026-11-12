import sys,re,subprocess; sys.path.insert(0,'.')
from lib import *
exec(open('13_q4.py').read().split("# per plan")[0].replace("print(","(lambda *a,**k:None)("))
# rounds to first zero per plan
byplan=collections.defaultdict(list)
for r in sonn:
    p=plan_of(r)
    if p: byplan[p].append(r)
rtz=[];nz=0;tot_with=0;firstzero=0
for p,L in byplan.items():
    L.sort(key=lambda r:r['t0'])
    tot_with+=1
    idx=[i for i,r in enumerate(L) if z(r)]
    if idx:
        rtz.append(idx[0]+1)
        if idx[0]==0: firstzero+=1
    else: nz+=1
print('plans with >=1 sonnet review',tot_with,'reached a zero-finding review',len(rtz),'never (as far as seen)',nz)
print('reviews up to first zero: mean %.2f median %s p90 %s ; first review already zero in %d plans'%(statistics.mean(rtz),statistics.median(rtz),pct(rtz,90),firstzero))
# review agent time/tokens
for tr in('sonnet','opus'):
    L=[r for r in rev if rtier(r)==tr]
    w=[wall(r)/60 for r in L]; u=[tokens(r)[4] for r in L]
    print(tr,'review agents',len(L),'wall med %.1f p90 %.1f min; total h %.0f; est$ total %.0f med %.2f'%(statistics.median(w),pct(w,90),sum(w)/60,sum(u),statistics.median(u)))
# git: numstat
out=subprocess.run(['git','-C','<project-root>','log','--all','--since=2026-09-27','--no-merges','--format=@@%H\t%s','--numstat'],capture_output=True,text=True).stdout
C=collections.Counter(); L=collections.Counter(); n=0
cur=None
commits=[]
for line in out.split('\n'):
    if line.startswith('@@'):
        if cur: commits.append(cur)
        cur={'s':line.split('\t',1)[1] if '\t' in line else '', 'f':[]}
    elif line.strip() and cur is not None:
        p=line.split('\t')
        if len(p)==3:
            a=int(p[0]) if p[0].isdigit() else 0; d=int(p[1]) if p[1].isdigit() else 0
            cur['f'].append((p[2],a+d))
if cur: commits.append(cur)
def area(f):
    if f.startswith('.planning/') or '/.planning/' in f: return 'planning-docs'
    if f.startswith('docs/') or f.endswith('.md'): return 'docs'
    if re.search(r'\.test\.|__tests__|/tests?/|e2e-charlotte|\.spec\.',f): return 'tests'
    if 'migrations/' in f: return 'migrations'
    if f.startswith('scripts/') or f.startswith('.claude/') or f.startswith('.github/'): return 'scripts/ci/rules'
    return 'src'
cc=collections.Counter(); lc=collections.Counter()
for c in commits:
    areas=set(area(f) for f,_ in c['f'])
    key='+'.join(sorted(areas)) if len(areas)<=1 else 'mixed'
    cc[key if len(areas)<=1 else 'mixed']+=1
    for f,n in c['f']: lc[area(f)]+=n
print('non-merge commits',len(commits)); print(cc.most_common(10)); tl=sum(lc.values()); print({k:'%.1f%%'%(100*v/tl) for k,v in lc.most_common()}, 'total changed lines',tl)
# src-touching commits share
print('commits touching any src: ',sum(1 for c in commits if any(area(f)=='src' for f,_ in c['f'])))
print('commits touching ONLY planning-docs/docs:',sum(1 for c in commits if c['f'] and all(area(f) in('planning-docs','docs') for f,_ in c['f'])))
