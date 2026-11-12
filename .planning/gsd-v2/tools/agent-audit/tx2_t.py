from tx2_d import *
n=0
for p,(ro,calls,order,res,final) in list(ALL.items()):
    hb=[calls[i][1].get('message','') for i in order if calls[i][0]=='SubagentHandback']
    if hb: ALL[p]=(ro,calls,order,res,hb[-1]); n+=1
pickle.dump(ALL,open('tx2_all.pkl','wb'))
print('handback used',n, collections.Counter(v[0] for p,v in ALL.items() if any(v[1][i][0]=='SubagentHandback' for i in v[2])))
