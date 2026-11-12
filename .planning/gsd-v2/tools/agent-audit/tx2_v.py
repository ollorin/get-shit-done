from tx2_d import *
PR=pickle.load(open('tx2_prompts.pkl','rb'))
S=[p for p,v in ALL.items() if v[0]=='gsd-docs-updater']
kw={'drift/stale/fix':r'drift|stale|incorrect|wrong|fix','SUMMARY path given':r'SUMMARY\.md','reads source':r'source','ADR/architecture':r'ADR|architecture','commit only paths':r'git commit -- |only (your|the) paths|only those paths','vale/markdownlint':r'vale|markdownlint','frontmatter':r'frontmatter|front matter','no-padding':r'padding|invent','return contract':r'written_files'}
print({k:sum(1 for p in S if re.search(v,PR[p],re.I)) for k,v in kw.items()},len(S))
import random; random.seed(3)
for p in random.sample(S,3): print('---',os.path.basename(p)); print(PR[p][:700])
# hook failures at commit
hf=0;rt=0
for p in S:
    v=ALL[p]
    for i in v[2]:
        t=v[3].get(i,'')
        if v[1][i][0]=='Bash' and re.search(r'git (-C \S+ )?commit',v[1][i][1].get('command','')):
            rt+=1
            if re.search(r'hook|error|vale|markdownlint|failed',t,re.I) and re.search(r'✖|error|failed|rejected',t,re.I): hf+=1
print('commit attempts',rt,'with hook-ish errors',hf)
