from tx2_d import *
PR=pickle.load(open('tx2_prompts.pkl','rb'))
for ro in ['gsd-plan-checker','gsd-verifier','gsd-test-writer','gsd-debugger','gsd-docs-updater','gsd-charlotte-qa','reviewer']:
    S=[(p,v) for p,v in ALL.items() if v[0]==ro]
    api=[p for p,v in S if (v[4] or '').startswith('API Error')]
    nof=[p for p,v in S if not (v[4] or '').strip()]
    print(ro,len(S),'final=API Error',len(api),'empty final',len(nof), collections.Counter(re.sub(r'\d+','N',(ALL[p][4] or '')[:70]) for p in api).most_common(3))
S=[(p,v) for p,v in ALL.items() if v[0]=='gsd-test-writer']
print('RED in prompt',sum(1 for p,v in S if re.search(r'\bRED\b|red-first|must fail',PR.get(p,''))),'of',len(S))
print('prompts mention "do not fix"/no production edits',sum(1 for p,v in S if re.search(r'(do not|never|don.t) (edit|touch|fix|modify|change) (any )?(production|implementation|source)|production (code )?(is )?(off|read-only)|no production',PR.get(p,''),re.I)))
