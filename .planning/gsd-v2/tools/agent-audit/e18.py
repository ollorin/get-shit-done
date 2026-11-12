from common import *
import json
S=rs('gsd-executor')
smw=0; dc=0; dev=0; rule=0; sc=0; none=0; sums=[]
for r in S:
    for l in open(r['path']):
        if '-SUMMARY.md' not in l or '"Write"' not in l: continue
        try: d=json.loads(l)
        except: continue
        m=d.get('message')
        if not isinstance(m,dict) or not isinstance(m.get('content'),list): continue
        for b in m['content']:
            if b.get('type')=='tool_use' and b['name']=='Write' and b['input'].get('file_path','').endswith('-SUMMARY.md'):
                c=b['input'].get('content',''); smw+=1; sums.append(len(c))
                dc+='## Defect Classes' in c; dev+=bool(re.search(r'(?i)deviation',c)); rule+=bool(re.search(r'Rule [1-4]\b',c)); sc+='Self-Check' in c
                none+= bool(re.search(r'None found\.\s*$',c,re.M) and not 'reviewed by' in c)
import statistics as st
print('SUMMARY writes',smw,'with Defect Classes',dc,'Deviation mention',dev,'Rule N cited',rule,'Self-Check in write',sc,'bare None found',none,'median bytes',st.median(sums),'max',max(sums))
