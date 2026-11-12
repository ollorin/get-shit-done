from tx2_d import *
n=0
for p,(rr,calls,order,res,final) in ALL.items():
    if rr!='gsd-test-writer': continue
    for i in order:
        if calls[i][0]=='Bash' and 'sed -i' in calls[i][1].get('command',''):
            print(os.path.basename(p)[:14],calls[i][1]['command'][:200].replace('\n',' ')); n+=1; break
