from common import *
S=rs('gsd-phase-coordinator')
for r in S:
    ev=P[r['path']]
    for i,e in enumerate(ev):
        if e[0]=='tu' and e[1]=='Write' and not any(k in (e[2].get('p') or '') for k in('/.tmp/','/.planning/')): 
            print(bn(r),'WRITE',e[2]['p'],e[2]['n'], r['meta'].get('description'))
        if e[0]=='tu' and e[1]=='Edit' and re.search(r'\.(ts|tsx)$',e[2].get('p') or ''):
            print(bn(r),'EDIT',e[2]['p'], r['meta'].get('description'))
            # next few events
            for x in ev[i+1:i+8]:
                if x[0]=='text': print('    text:',x[1][:200].replace('\n',' '))
                if x[0]=='tu': print('    tu:',x[1],str(x[2])[:150])
cnt=0
for r in S:
    for e in P[r['path']]:
        if e[0]=='tu' and e[1]=='Bash' and re.search(r"sed -i|perl -pi|python3? [^|]*write_text|open\([^)]*['\"]w['\"]\)",e[2]['cmd']) and re.search(r'\.(ts|tsx|sql)\b',e[2]['cmd']) and '.planning' not in e[2]['cmd']:
            cnt+=1
            if cnt<=5: print(bn(r),'BASHEDIT',e[2]['cmd'][:200].replace('\n',' '))
print('bash code edits',cnt)
