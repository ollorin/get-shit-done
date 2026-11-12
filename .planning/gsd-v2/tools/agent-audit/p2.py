from common import *
import json
S=rs('gsd-planner')
plans=[]
for r in S:
    for l in open(r['path']):
        if '"Write"' not in l: continue
        try: d=json.loads(l)
        except: continue
        m=d.get('message')
        if not isinstance(m,dict) or not isinstance(m.get('content'),list): continue
        for b in m['content']:
            if b.get('type')=='tool_use' and b['name']=='Write' and b['input'].get('file_path','').endswith('-PLAN.md'): plans.append((bn(r),b['input']['content']))
print(len(plans))
mt=collections.Counter()
for n,c in plans:
    for m in re.findall(r'<model>[^<]*</model>|\bmodel="[^"]*"|\bmodel:\s*\w+',c): mt[m[:40]]+=1
print(mt.most_common(10))
print('plans with e2e_flows: [] only',sum(1 for n,c in plans if re.search(r'e2e_flows:\s*\[\]',c)),'non-empty',sum(1 for n,c in plans if re.search(r'e2e_flows:\s*\n\s*-',c)))
print('charlotte waiver mention',sum(1 for n,c in plans if re.search(r'(?i)charlotte[^\n]{0,80}(waiv|not run|n/a)|waiv[^\n]{0,60}charlotte',c)))
print('plans with tdd=true & no .tsx: n/a')
i=[c for n,c in plans if '<task' in c][3]
print(re.findall(r'<task[^>]*>',i)[:4])
print(re.findall(r'(?i)haiku[^\n]{0,80}',i)[:3])
# tasks per plan distribution by 
