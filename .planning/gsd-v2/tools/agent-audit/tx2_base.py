import sys,json,collections
sys.path.insert(0,'<home>/get-shit-done/scripts/gsd-metrics')
import lib
R=lib.load()
ROLES=['gsd-plan-checker','gsd-verifier','gsd-test-writer','gsd-debugger','gsd-docs-updater','gsd-charlotte-qa']
def sel(role):
    if role=='reviewer':
        return [r for r in R if lib.role(r)=='general-purpose' and 'review' in (r['meta'].get('description') or '').lower()]
    return [r for r in R if lib.role(r)==role]
def events(path):
    for l in open(path):
        try: yield json.loads(l)
        except: pass
