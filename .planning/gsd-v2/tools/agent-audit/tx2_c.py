from tx2_parse import *
ALL={}
for ro in ROLES+['reviewer']:
    for r in sel(ro):
        calls,order,res,final=parse(r)
        ALL[r['path']]=(ro,calls,order,res,final)
pickle.dump(ALL,open('tx2_all.pkl','wb'))
print(len(ALL))
