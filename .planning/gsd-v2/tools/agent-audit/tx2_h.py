from tx2_base import *
import pickle,re
PROMPT={}
for ro in ROLES+['reviewer']:
    for r in sel(ro):
        for e in events(r['path']):
            m=e.get('message')
            if e.get('type')=='user' and isinstance(m,dict):
                c=m['content']
                if isinstance(c,list): c=' '.join(b.get('text','') for b in c if b.get('type')=='text')
                PROMPT[r['path']]=c; break
pickle.dump(PROMPT,open('tx2_prompts.pkl','wb'))
KW={'claude.md-dup':r'zero tolerance|path-trace|never (use )?`?throw|--no-verify|Result<|zg query|\.tmp/|git stash|SendMessage','fp':r'immutab|Result<|neverthrow|ResultAsync','no-edit':r'read-only|do not edit|not edit','severity':r'BLOCKER|HIGH','fileline':r'file:line','mutation':r'mutat','verdict':r'verdict','report-path':r'REVIEW|\.md','model-note':r'fresh|independent'}
for ro in ROLES+['reviewer']:
    S=sel(ro); L=[len(PROMPT.get(r['path'],'')) for r in S]
    print(ro,len(S),'prompt chars med',lib.pct(L,50),'p90',lib.pct(L,90),'max',max(L),{k:round(sum(1 for r in S if re.search(v,PROMPT.get(r['path'],''),re.I))/len(S),2) for k,v in KW.items()})
