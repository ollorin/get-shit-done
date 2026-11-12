import sys; sys.path.insert(0,'<home>/get-shit-done/scripts/gsd-metrics')
import lib, pickle, collections, os, re
R=lib.load(); P=pickle.load(open('<project-root>/.tmp/gsd-v2/agent-audit/parsed.pkl','rb'))
def rs(role): return [r for r in R if lib.role(r)==role]
def bn(r): return os.path.basename(r['path'])
def last_text(ev):
    t=[e for e in ev if e[0]=='text']; return t[-1][1] if t else ''
