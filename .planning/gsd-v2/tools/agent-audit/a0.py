import sys; sys.path.insert(0,'<home>/get-shit-done/scripts/gsd-metrics')
import lib, collections, json
R=lib.load()
print(len(R))
c=collections.Counter(lib.role(r) for r in R)
print(c.most_common(30))
r=R[0]; print({k:(str(v)[:150]) for k,v in r.items()})
