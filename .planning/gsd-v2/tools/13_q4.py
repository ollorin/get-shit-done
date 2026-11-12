import sys,re; sys.path.insert(0,'.')
from lib import *
R=load()
PID=re.compile(r'\b(\d{3}(?:\.\d)?)-(\d{2}[a-z]?)\b')
PH=re.compile(r'\b(3[6-9]\d|40\d)(\.\d)?\b')
def plan_of(r):
    d=r['meta'].get('description') or ''
    m=PID.search(d)
    if m: return m.group(1)+'-'+m.group(2)
    m2=PID.search((r.get('first_prompt') or '')[:600])
    if m2: return m2.group(1)+'-'+m2.group(2)
    return None
ZERO=re.compile(r'zero[ -]findings|\b0 findings|no findings|findings:\s*0\b|zero[ -]finding|\*\*zero|^zero|no blocker|nothing to fix|no (high|medium|med) (or|,)',re.I)
rev=[r for r in R if activity(r)=='review-verify' and r.get('last_text')]
sonn=[r for r in rev if rtier(r)=='sonnet']; opu=[r for r in rev if rtier(r)=='opus']
def z(r): return bool(ZERO.search(r['last_text'][:420]))
print('review-verify agents',len(rev),'sonnet',len(sonn),'opus',len(opu))
print('sonnet zero-finding share (first 420 chars regex) %.1f%%'%(100*sum(z(r) for r in sonn)/len(sonn)))
print('opus zero-finding share %.1f%%'%(100*sum(z(r) for r in opu)/len(opu)))
# severity counts mention
def sev(r):
    t=r['last_text'][:600]
    h=re.search(r'(\d+)\s*(HIGH|BLOCKER|CRIT)',t,re.I); m=re.search(r'(\d+)\s*(MED|MEDIUM)',t,re.I); l=re.search(r'(\d+)\s*LOW',t,re.I)
    return (int(h.group(1)) if h else None, int(m.group(1)) if m else None, int(l.group(1)) if l else None)
S=[sev(r) for r in sonn]
print('sonnet reviews that state HIGH>0: %d, MED>0: %d, LOW>0: %d, of %d'%(sum(1 for s in S if s[0]),sum(1 for s in S if s[1]),sum(1 for s in S if s[2]),len(S)))
# per plan
P=collections.defaultdict(lambda:{'exec':0,'son':0,'opus_rev':0,'ruling':0,'fix':0,'zero':0,'rounds':0,'wall':0,'usd':0,'rev_wall':0,'rev_usd':0,'impl_wall':0,'impl_usd':0})
for r in R:
    p=plan_of(r)
    if not p: continue
    a=activity(r); x=P[p]; u=tokens(r)[4]; w=wall(r)/3600
    x['wall']+=w;x['usd']+=u
    if a in('plan-execution','implementation-fix','test-writing'): x['impl_wall']+=w;x['impl_usd']+=u
    if a=='plan-execution': x['exec']+=1
    if a=='implementation-fix': x['fix']+=1
    if a=='review-verify':
        x['rev_wall']+=w;x['rev_usd']+=u
        if rtier(r)=='sonnet': x['son']+=1; x['zero']+= 1 if r.get('last_text') and z(r) else 0
        else: x['opus_rev']+=1
        m=re.search(r'(?:round|\br)\s*(\d+)',(r['meta'].get('description') or ''),re.I)
        if m: x['rounds']=max(x['rounds'],int(m.group(1)))
    if a=='ruling': x['ruling']+=1
plans=[p for p,x in P.items() if x['exec']>0 or x['son']>0]
withrev=[p for p in plans if P[p]['son']+P[p]['opus_rev']>0]
print('plans seen',len(plans),'with >=1 review agent',len(withrev))
sr=[P[p]['son'] for p in withrev]
print('sonnet reviews per reviewed plan: mean %.2f median %s p90 %s max %s'%(statistics.mean(sr),statistics.median(sr),pct(sr,90),max(sr)))
orv=[P[p]['opus_rev'] for p in withrev]; print('opus reviews/plan mean %.2f; rulings/plan mean %.2f'%(statistics.mean(orv),statistics.mean([P[p]['ruling'] for p in withrev])))
mr=[P[p]['rounds'] for p in withrev if P[p]['rounds']]
print('max round number stated: mean %.2f median %s (n=%d)'%(statistics.mean(mr),statistics.median(mr),len(mr)))
print('fix agents per reviewed plan mean %.2f'%statistics.mean([P[p]['fix'] for p in withrev]))
tw=sum(P[p]['wall'] for p in withrev); tu=sum(P[p]['usd'] for p in withrev)
rw=sum(P[p]['rev_wall'] for p in withrev); ru=sum(P[p]['rev_usd'] for p in withrev)
iw=sum(P[p]['impl_wall'] for p in withrev); iu=sum(P[p]['impl_usd'] for p in withrev)
print('plan-attributed (desc contains plan id) agent-h %.0f est$ %.0f; review share h %.1f%% $ %.1f%%; implement share h %.1f%% $ %.1f%%'%(tw,tu,100*rw/tw,100*ru/tu,100*iw/tw,100*iu/tu))
# review hours to implementation ratio
print('review agent-h / impl agent-h = %.2f ; review $/impl $ = %.2f'%(rw/iw,ru/iu))
# git: commits
G=[l.rstrip('\n').split('\t',2) for l in open('out/gitlog.tsv')]
subj=[g[2] for g in G if len(g)==3]
print('commits',len(subj))
cat=collections.Counter()
for s in subj:
    sl=s.lower()
    if re.search(r'review',sl): cat['review-related']+=1
    elif re.search(r'^(fix|fix\()',sl): cat['fix']+=1
    elif re.search(r'^docs?\(',sl): cat['docs']+=1
    elif re.search(r'^test',sl): cat['test']+=1
    elif re.search(r'^(feat)',sl): cat['feat']+=1
    elif re.search(r'^(chore|ci|build|refactor|merge)',sl): cat['chore/merge']+=1
    else: cat['other']+=1
print(cat)
print([s for s in subj if re.search(r'review round|round \d|review fix',s,re.I)][:6])
