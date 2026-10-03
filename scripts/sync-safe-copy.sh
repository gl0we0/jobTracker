#!/usr/bin/env bash
set -euo pipefail

# Creates/updates a sanitized development copy of JobTracker.
# Default target: sibling folder in /text named JobTracker-safe.
#
# Excludes by default:
# - jobs/ (live job data)
# - uploads/ (runtime file uploads)
# - node_modules/ (reinstall in target)
#
# Usage:
#   ./scripts/sync-safe-copy.sh
#   SAFE_DEST=/some/path ./scripts/sync-safe-copy.sh
#   ./scripts/sync-safe-copy.sh --include-jobs

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TEXT_ROOT="$(cd "${SOURCE_DIR}/../.." && pwd)"
DEST_DIR="${SAFE_DEST:-${TEXT_ROOT}/JobTracker-safe}"
INCLUDE_JOBS="false"

for arg in "$@"; do
    case "$arg" in
        --include-jobs)
            INCLUDE_JOBS="true"
            ;;
        --help|-h)
            sed -n '1,24p' "$0"
            exit 0
            ;;
        *)
            echo "Unknown argument: $arg" >&2
            exit 1
            ;;
    esac
done

if ! command -v rsync >/dev/null 2>&1; then
    echo "rsync is required but not installed." >&2
    exit 1
fi

mkdir -p "$DEST_DIR"

EXCLUDES=(
    --exclude ".git/"
    --exclude "node_modules/"
    --exclude "uploads/"
    --exclude "*.log"
)

if [[ "$INCLUDE_JOBS" != "true" ]]; then
    EXCLUDES+=(--exclude "jobs/")
fi

rsync -a --delete "${EXCLUDES[@]}" "${SOURCE_DIR}/" "${DEST_DIR}/"

if [[ "$INCLUDE_JOBS" != "true" ]]; then
    mkdir -p "$DEST_DIR/jobs"
    : > "$DEST_DIR/jobs/.keep"
fi

mkdir -p "$DEST_DIR/uploads"

cat <<MSG
Safe copy synchronized.
- Source:      $SOURCE_DIR
- Destination: $DEST_DIR
- Include jobs: $INCLUDE_JOBS
MSG
