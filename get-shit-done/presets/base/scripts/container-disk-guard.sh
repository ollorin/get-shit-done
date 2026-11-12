#!/bin/sh
# container-disk-guard.sh: report-first guard against unbounded growth of a container runtime's disk use.
#
# Superseded image tags and build cache accumulate until the host runs out of disk. Default and --dry-run only REPORT the
# host free space, what the runtime could reclaim and what would be removed. --live (an interactive terminal plus two
# confirmations) removes, and only what the runtime itself proves unused:
#   - dangling images (image prune, never the "all" form)
#   - unused build cache (builder prune, never the "all" form)
#   - images with ZERO containers per `system df -v`, removed with a NON-FORCED rmi: the runtime refuses if anything still
#     references the image
# Volumes are never pruned; they are reported only. No system prune, no volume prune, ever.
#
# The CLI is $CONTAINER_CLI (default: the common runtime CLI, set on the CLI= line). No CLI, or a runtime that does not answer: report mode prints that and
# exits 0; --live exits 1. Needs only POSIX sh, awk and df.
#
# Usage: scripts/container-disk-guard.sh [--dry-run] [--live] [--force]

CLI="${CONTAINER_CLI:-docker}"
MIN_FREE_GB="${CONTAINER_GUARD_MIN_FREE_GB:-15}"
MAX_RECLAIM_GB="${CONTAINER_GUARD_MAX_RECLAIM_GB:-5}"
LIVE=false
FORCE=false

for arg in "$@"; do
  case "$arg" in
    --dry-run) LIVE=false ;;
    --live)    LIVE=true ;;
    --force)   FORCE=true ;;
    --help|-h)
      cat <<EOF
Usage: scripts/container-disk-guard.sh [--dry-run] [--live] [--force]

  --dry-run   Report only (the default even with no flags).
  --live      Remove dangling images, unused build cache and zero-container image tags. Needs an interactive terminal
              and two confirmations.
  --force     With --live: remediate even if no threshold is crossed.
  --help      Show this help.

Env overrides:
  CONTAINER_CLI                 Container runtime CLI (default: the CLI= line of this script)
  CONTAINER_GUARD_MIN_FREE_GB   Host free-space floor in GB (default 15)
  CONTAINER_GUARD_MAX_RECLAIM_GB  Reclaimable ceiling in GB for images plus build cache (default 5)

Volumes, running containers and in-use images are never touched.
EOF
      exit 0 ;;
    *) echo "Unknown arg: $arg" >&2; exit 1 ;;
  esac
done

if $LIVE && [ ! -t 0 ]; then
  echo "refused: --live needs an interactive terminal (stdin is not a terminal); nothing was touched" >&2
  exit 1
fi

if ! command -v "$CLI" >/dev/null 2>&1 || ! "$CLI" info >/dev/null 2>&1; then
  echo "no reachable container runtime ($CLI): nothing to check"
  if $LIVE; then exit 1; fi
  exit 0
fi
command -v awk >/dev/null 2>&1 || { echo "error: awk not found" >&2; exit 1; }

# A size string ("1.274GB", "512MB", "0B") to GB.
to_gb() {
  echo "$1" | awk '{
    if (match($0, /^[0-9.]+/) == 0) { print 0; exit }
    num = substr($0, RSTART, RLENGTH); unit = substr($0, RLENGTH + 1)
    if (unit == "GB") f = 1; else if (unit == "MB") f = 1/1024; else if (unit == "kB" || unit == "KB") f = 1/1024/1024; else if (unit == "B") f = 1/1024/1024/1024; else f = 0
    printf "%.4f", num * f
  }'
}

host_free_gb() {
  df -k / | awk 'NR==2{printf "%.2f", $4/1024/1024}'
}

df_field() {
  # $1 = row type, $2 = column (count, size, reclaimable)
  echo "$DF_ROWS" | awk -F'|' -v t="$1" -v c="$2" '$1==t { if (c=="count") print $2; else if (c=="size") print $3; else print $4 }'
}

BEFORE_FREE=$(host_free_gb)
DF_ROWS=$("$CLI" system df --format '{{.Type}}|{{.TotalCount}}|{{.Size}}|{{.Reclaimable}}')
IMAGES_RECLAIM_RAW=$(df_field "Images" reclaimable | awk '{print $1}')
BUILD_RECLAIM_RAW=$(df_field "Build Cache" reclaimable | awk '{print $1}')
IMAGES_RECLAIM_GB=$(to_gb "${IMAGES_RECLAIM_RAW:-0B}")
BUILD_RECLAIM_GB=$(to_gb "${BUILD_RECLAIM_RAW:-0B}")
RECLAIM_GB=$(awk -v a="$IMAGES_RECLAIM_GB" -v b="$BUILD_RECLAIM_GB" 'BEGIN{printf "%.4f", a+b}')

echo "=== BEFORE ==="
df -h / | awk 'NR==1||NR==2'
echo
"$CLI" system df
echo
echo "  INFO  Host free space: ${BEFORE_FREE} GB (floor: ${MIN_FREE_GB} GB)"
echo "  INFO  Reclaimable, images plus build cache only (volumes excluded by design): ${RECLAIM_GB} GB (ceiling: ${MAX_RECLAIM_GB} GB)"

TRIGGER=false
if awk -v f="$BEFORE_FREE" -v m="$MIN_FREE_GB" 'BEGIN{exit !(f < m)}'; then
  echo "  WARN  Host free space is below the floor"
  TRIGGER=true
fi
if awk -v r="$RECLAIM_GB" -v m="$MAX_RECLAIM_GB" 'BEGIN{exit !(r > m)}'; then
  echo "  WARN  Reclaimable space is above the ceiling"
  TRIGGER=true
fi

echo
echo "=== Remediation plan ==="
DANGLING_COUNT=$("$CLI" images -f dangling=true -q | wc -l | tr -d ' ')
BUILD_CACHE_COUNT=$(df_field "Build Cache" count)
UNUSED_IMAGES=$("$CLI" system df -v | awk '
  /^Images space usage:/ {section="images"; next}
  /^Containers space usage:/ {section=""; next}
  section=="images" && NF==0 {next}
  section=="images" && $0 ~ /^REPOSITORY/ {next}
  section=="images" {print}
' | awk '{if ($NF=="0") print $1":"$2}')
UNUSED_COUNT=$(printf '%s\n' "$UNUSED_IMAGES" | awk 'NF>0' | wc -l | tr -d ' ')

echo "  dangling images: $DANGLING_COUNT; build cache entries: ${BUILD_CACHE_COUNT:-0}; zero-container image tags: $UNUSED_COUNT"
for img in $UNUSED_IMAGES; do echo "    would run: $CLI rmi $img"; done
echo "  INFO  Volumes are NEVER touched by this script (data safety)."

if ! $LIVE; then
  echo
  echo "REPORT ONLY: no changes were made. Re-run with --live to remediate."
  exit 0
fi

if ! $TRIGGER && ! $FORCE; then
  echo "  PASS  No threshold crossed: nothing to do (pass --force to remediate anyway)"
  exit 0
fi

echo
printf 'Type YES (all caps) to proceed, anything else aborts: '
read -r CONFIRM1
if [ "$CONFIRM1" != "YES" ]; then echo "Aborted: nothing was removed."; exit 0; fi
printf 'Second confirmation, type the count of zero-container image tags (%s): ' "$UNUSED_COUNT"
read -r CONFIRM2
if [ "$CONFIRM2" != "$UNUSED_COUNT" ]; then echo "Count did not match: aborted, nothing was removed."; exit 0; fi

if [ "$DANGLING_COUNT" != "0" ]; then "$CLI" image prune -f; fi
if [ "${BUILD_CACHE_COUNT:-0}" != "0" ]; then "$CLI" builder prune -f; fi
for img in $UNUSED_IMAGES; do
  if "$CLI" rmi "$img" >/dev/null 2>&1; then echo "    removed: $img"; else echo "  WARN  kept (runtime refused, still referenced): $img"; fi
done

echo
echo "=== AFTER ==="
df -h / | awk 'NR==1||NR==2'
echo
"$CLI" system df
echo
echo "  INFO  Host free space: ${BEFORE_FREE} GB -> $(host_free_gb) GB"
