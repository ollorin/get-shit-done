from tx2_d import *
PR=pickle.load(open('tx2_prompts.pkl','rb'))
S=[(p,v) for p,v in ALL.items() if v[0]=='reviewer']
h=[P[p]['meta'].get('description') for p,v in S if lib.model(P[p])=='haiku']
print(h[:12])
# reviewers that edit source though prompt says read-only
n=0;ex=[]
for p,(rr,calls,order,res,final) in S:
    ed=[calls[i][1].get('file_path','') for i in order if calls[i][0]=='Edit' and not re.search(r'\.planning|\.tmp',calls[i][1].get('file_path',''))]
    if ed and re.search(r'read-only|do not edit|never edit|not edit',PR.get(p,''),re.I): n+=1; ex.append((os.path.basename(p),(P[p]['meta'].get('description') or '')[:40],ed[0][-50:]))
print('edit src despite read-only wording',n,ex[:4])
# review-fix descs among edit_src
ed=[(P[p]['meta'].get('description') or '')[:40] for p,(rr,calls,order,res,final) in S if any(calls[i][0]=='Edit' and not re.search(r'\.planning|\.tmp',calls[i][1].get('file_path','')) for i in order)]
print(ed[:10])
# top cost reviewers
rows=sorted(S,key=lambda x:-lib.tokens(P[x[0]])[4])[:5]
for p,v in rows:
    r=P[p]; print(os.path.basename(p),lib.model(r),round(lib.tokens(r)[4],1),r['max_ctx'],r['meta'].get('description'),r.get('api_errors'),r['tool_counts'])
# ctx>200k reviewers & compaction
print('compacted',sum(1 for p,v in S if P[p].get('api_errors')),'ctx>250k',sum(1 for p,v in S if P[p]['max_ctx']>250000))
