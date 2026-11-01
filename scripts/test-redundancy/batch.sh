#!/bin/sh
# Runs the module list sequentially (one process at a time). Output: one summary line per module.
cd "$(dirname "$0")/../.."
L=apps/api/libs; F=apps/api/functions
rr() {
  t0=$(date +%s)
  scripts/test-redundancy/go.sh "$1" "$2" "$3" "$4" | python3 -I -c "
import sys,json
d=json.loads(sys.stdin.read()); print('$1',d['srcLoc'],d['testLoc'],'cases',d['nCases'],'mut',d['nMutants'],d['outcomes'],'greedy',d['greedyCount'],'dropLOC',d['droppableLoc'],'/',d['caseLocTotal'],'ms',d['totalMutantMs'],'unm',len(d['unmatchedLocCases']),d['killedUnattributed'])"
  echo "  wall $1: $(( $(date +%s) - t0 ))s"
}
rr iso-date $L/infrastructure/src/lib/utils/iso-date.ts $L/infrastructure/src/lib/utils/iso-date.test.ts
rr evaluate-region-gate $L/domain/src/lib/market/evaluate-region-gate.ts $L/domain/src/lib/market/evaluate-region-gate.test.ts
rr structured-logger $L/infrastructure/src/lib/logging/structured-logger.ts $L/infrastructure/src/lib/logging/structured-logger.test.ts
rr deletion-schedule $L/domain/src/lib/auth/deletion-schedule.ts $L/domain/src/lib/auth/deletion-schedule.test.ts
rr fp-utilities $L/infrastructure/src/lib/response/fp-utilities.ts $L/infrastructure/src/lib/response/fp-utilities.test.ts 8
rr better-stack-shipper $L/infrastructure/src/lib/logging/better-stack-shipper.ts $L/infrastructure/src/lib/logging/better-stack-shipper.test.ts
rr iap-store-adapter $F/payments/services/iap-store-adapter.ts $F/payments/services/iap-store-adapter.test.ts
rr withdrawal-settlement $F/payments/services/withdrawal-settlement.ts,$F/payments/services/withdrawal-session-claim.ts,$F/payments/services/withdrawal-release.ts,$F/payments/services/withdrawal-reversal.ts,$F/payments/services/payout-error-classification.ts $F/payments/services/withdrawal-settlement.test.ts 8
rr coin-selection $L/domain/src/lib/market/coin-selection.ts $L/domain/src/lib/market/coin-selection.test.ts
rr evaluate-wagering-mode $L/domain/src/lib/market/evaluate-wagering-mode.ts $L/domain/src/lib/market/evaluate-wagering-mode.test.ts
date
