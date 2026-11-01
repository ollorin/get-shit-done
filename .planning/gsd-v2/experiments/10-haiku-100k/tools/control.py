import sys,json,statistics as st
sys.path.insert(0,'/Users/ollorin/get-shit-done/scripts/ab-eval'); sys.path.insert(0,'/Users/ollorin/ab-eval/scratch/h100k')
import ab_aggregate as AG, tier
rows=AG.load_runs(); sup=AG.load_superseded()
sup=set(sup) if not isinstance(sup,dict) else set(sup.keys())
ctl=[r for r in rows if r['variant']=='A' and r['task_id'] in('E4','E6','E7') and r['run_id'] not in sup and r['status']=='done']
out=[tier.analyse(r) for r in ctl]
for o in out: print(o['run'][:24],o['task'],o['calls'],o['above'],'sub',o['sub_calls'],o['sub_above'],'peak',o['peak'],'flat',round(o['flat'],3),'tier',round(o['tier'],3),'wall',o['wall'],o['acc'],o['commits'])
json.dump(out,open('control_rows.json','w'))
