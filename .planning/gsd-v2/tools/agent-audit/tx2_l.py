from tx2_d import *
import random
random.seed(1)
C=[]
for p,(rr,calls,order,res,final) in ALL.items():
    if rr!='gsd-plan-checker': continue
    for i in order:
        if calls[i][0]=='Bash' and TEST.search(calls[i][1].get('command','')): C.append((os.path.basename(p),norm(calls[i][1]['command'])[:140]))
for x in random.sample(C,12): print(x)
# plan-checker editing plans
E=collections.Counter()
for p,(rr,calls,order,res,final) in ALL.items():
    if rr!='gsd-plan-checker': continue
    for i in order:
        n,inp=calls[i]
        if n=='Bash':
            c=inp.get('command','')
            if re.search(r"sed -i|perl -i|python3?.*write_text|\bcat >|tee ",c): E[re.search(r"(\.planning/\S+|\.tmp/\S+|apps/\S+)",c).group(1)[:60] if re.search(r"(\.planning/\S+|\.tmp/\S+|apps/\S+)",c) else 'x']+=1
print(E.most_common(10))
print(sum(1 for p,v in ALL.items() if v[0]=='gsd-plan-checker' and re.search(r'fix(es|ed)? .*(plans?|myself)|my fixes|I (made|applied)',v[4] or '',re.I)))
