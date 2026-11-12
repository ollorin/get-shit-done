import sys,collections,json,datetime,re
sys.path.insert(0,'<home>/get-shit-done/scripts/gsd-metrics')
import lib
R=lib.load()
role=sys.argv[1]; n=int(sys.argv[2]) if len(sys.argv)>2 else 40
for r in sorted([r for r in R if lib.role(r)==role],key=lambda r:r['t0']):
    d=(r['meta'].get('description') or '')[:70]
    fp=(r.get('first_prompt') or '')[:160].replace('\n',' ')
    lt=(r.get('last_text') or '')[:120].replace('\n',' ')
    t=datetime.datetime.utcfromtimestamp(r['t0']).strftime('%m-%d %H:%M')
    print(t,lib.rtier(r),r['path'].split('/')[-1][:30],'|',d,'|',fp,'|| LAST:',lt)
