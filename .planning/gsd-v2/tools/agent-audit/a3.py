import sys; sys.path.insert(0,'<home>/get-shit-done/scripts/gsd-metrics')
import lib
R=lib.load()
for role in ['gsd-executor','gsd-phase-coordinator','gsd-planner']:
    rs=[r for r in R if lib.role(r)==role]
    print(role, sum(int(r['size']) for r in rs)/1e9,'GB', max(int(r['size']) for r in rs)/1e6)
