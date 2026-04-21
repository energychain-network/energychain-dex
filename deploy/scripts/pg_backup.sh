#!/usr/bin/env bash
#
# pg_backup.sh — periodic logical backup of the DEX Postgres database.
#
# This script is designed to run from cron on the deployment host:
#
#   # /etc/cron.d/dex-pgbackup
#   0 */6 * * * deploy /opt/energy-chain/dex/deploy/scripts/pg_backup.sh >> /var/log/dex-pgbackup.log 2>&1
#
# It produces gzip-compressed `pg_dump --format=custom` archives so we can
# restore individual tables and skip the search_index materialised view
# during DR drills. Old backups are pruned on a sliding window so a single
# host doesn't run out of disk if cron drifts.
#
# Required env (typically loaded from /etc/dex/backup.env):
#   PGHOST          (default: 127.0.0.1)
#   PGPORT          (default: 55432)   - matches docker-compose mapping
#   PGUSER          (default: dex)
#   PGDATABASE      (default: energy_dex)
#   PGPASSWORD      (no default; required)
#   BACKUP_DIR      (default: /var/backups/dex)
#   RETAIN_DAYS     (default: 14)
#   S3_DEST         optional - "s3://bucket/prefix" pushed via `aws s3 cp`
#
# The script is intentionally written to be re-entrant: it acquires a
# `flock` on a lock file so overlapping cron invocations queue rather than
# trampling each other.

set -euo pipefail

PGHOST=${PGHOST:-127.0.0.1}
PGPORT=${PGPORT:-55432}
PGUSER=${PGUSER:-dex}
PGDATABASE=${PGDATABASE:-energy_dex}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/dex}
RETAIN_DAYS=${RETAIN_DAYS:-14}
LOCKFILE=${LOCKFILE:-/var/run/dex-pgbackup.lock}

if [[ -z "${PGPASSWORD:-}" ]]; then
  echo "PGPASSWORD must be set (load from /etc/dex/backup.env)." >&2
  exit 2
fi

mkdir -p "$BACKUP_DIR"

stamp=$(date -u +%Y%m%dT%H%M%SZ)
out_file="$BACKUP_DIR/dex-${PGDATABASE}-${stamp}.dump"
log_file="$BACKUP_DIR/dex-${PGDATABASE}-${stamp}.log"

# Ensure only one instance runs at a time. Using fd 9 means subsequent shell
# commands inherit the held lock; the FD closes (and lock releases) when the
# script exits for any reason.
exec 9>"$LOCKFILE"
if ! flock -n 9; then
  echo "[$(date -u +%FT%TZ)] another pg_backup is already running; skipping." >&2
  exit 0
fi

echo "[$(date -u +%FT%TZ)] starting backup → $out_file"
export PGPASSWORD

# `--format=custom` lets us restore selectively with pg_restore -t/-l. The
# `search_index` MV is rebuilt on demand so we exclude its data to keep
# backups small. `--no-acl --no-owner` lets us restore into a different
# role/database during DR.
pg_dump \
  --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" \
  --format=custom --compress=6 \
  --no-acl --no-owner \
  --exclude-table-data='search_index' \
  --file="$out_file" 2> "$log_file"

actual_size=$(wc -c <"$out_file" | tr -d ' ')
echo "[$(date -u +%FT%TZ)] backup complete: ${actual_size} bytes"

# Optional: ship to object storage so a single-host failure doesn't lose the
# only copy. AWS CLI is the most portable; mirror to S3-compatible endpoints
# (Cloudflare R2, MinIO, etc.) via AWS_ENDPOINT_URL.
if [[ -n "${S3_DEST:-}" ]]; then
  if command -v aws >/dev/null 2>&1; then
    echo "[$(date -u +%FT%TZ)] uploading to $S3_DEST"
    aws s3 cp "$out_file" "$S3_DEST/$(basename "$out_file")" --only-show-errors
  else
    echo "[$(date -u +%FT%TZ)] WARNING: S3_DEST set but aws CLI not installed; skipping upload" >&2
  fi
fi

# Prune local backups older than RETAIN_DAYS. We deliberately don't prune the
# remote copy here – upstream lifecycle policies are a better fit for that.
find "$BACKUP_DIR" -maxdepth 1 -type f \
  \( -name "dex-*.dump" -o -name "dex-*.log" \) \
  -mtime +"${RETAIN_DAYS}" -print -delete \
  | sed 's/^/[pruned] /'

echo "[$(date -u +%FT%TZ)] done."
