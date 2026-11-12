from tx2_base import *
r=sel('gsd-verifier')[0]
print(r['path'], r['meta'])
import os
p=r['path']; print(os.path.exists(p), os.path.isdir(p))
