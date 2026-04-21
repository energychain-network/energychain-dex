#!/usr/bin/env bash
#
# pg_restore.sh — restore a DEX backup produced by pg_backup.sh.
#
#   ./pg_restore.sh /var/backups/dex/dex-energy_dex-20260101T000000Z.dump
#
# Required env (same as pg_backup.sh): PGHOST, PGPORT, PGUSER, PGDATABASE,
# PGPASSWORD. The script refuses to run unless DROP_FIRST=1 is set, to
# prevent accidental "restore on top of running prod" mistakes.

set -euo pipefail

dump=${1:-}
if [[ -z "$dump" ]]; then
  echo "usage: $0 <backup.dump>" >&2
  exit 2
fi
if [[ ! -r "$dump" ]]; then
  echo "cannot read $dump" >&2
  exit 2
fi

PGHOST=${PGHOST:-127.0.0.1}
PGPORT=${PGPORT:-55432}
PGUSER=${PGUSER:-dex}
PGDATABASE=${PGDATABASE:-energy_dex}

if [[ -z "${PGPASSWORD:-}" ]]; then
  echo "PGPASSWORD must be set" >&2
  exit 2
fi
export PGPASSWORD

if [[ "${DROP_FIRST:-0}" != "1" ]]; then
  echo "Refusing to restore in-place. Re-run with DROP_FIRST=1 if you really mean it." >&2
  echo "Recommended workflow: restore into a fresh DB, smoke test, then promote." >&2
  exit 3
fi

echo "[restore] dropping public schema in $PGDATABASE"
psql --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" \
  -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"

echo "[restore] piping $dump into $PGDATABASE"
pg_restore --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" \
  --no-owner --no-acl --jobs=4 --verbose "$dump"

echo "[restore] refreshing search_index materialised view"
psql --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" \
  -v ON_ERROR_STOP=1 -c "REFRESH MATERIALIZED VIEW CONCURRENTLY search_index;"

echo "[restore] complete."
