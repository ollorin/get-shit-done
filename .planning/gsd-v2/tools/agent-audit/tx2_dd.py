from tx2_d import *
for ro in ['gsd-plan-checker','gsd-test-writer','reviewer']:
    C=collections.Counter()
    for p,(rr,calls,order,res,final) in ALL.items():
        if rr!=ro: continue
        for i in order:
            if calls[i][0]=='Read' and len(res.get(i,''))>30000 and not calls[i][1].get('limit'):
                f=calls[i][1].get('file_path','')
                k='PLAN.md' if re.search(r'PLAN\.md$',f) else 'test file' if '.test.' in f else 'RESEARCH/CONTEXT/RULING' if re.search(r'RESEARCH|CONTEXT|RULING',f) else 'REVIEW/VERIF/SUMMARY' if re.search(r'REVIEW|VERIFICATION|SUMMARY',f) else 'migration .sql' if f.endswith('.sql') else 'other:'+os.path.basename(f)[:30]
                C[k]+=1
    print(ro,C.most_common(7))
