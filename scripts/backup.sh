#!/usr/bin/env bash
#
# Daily backup: PostgreSQL dump + mirror of the attachment files, optionally encrypted and
# synced off the machine. Cloud disk snapshots are not a substitute: they can catch the
# database mid-write.
#
#   0 3 * * * /opt/healthlog/scripts/backup.sh >> /var/log/healthlog-backup.log 2>&1
#
# Environment (all optional, can live in .env):
#   KEEP_DAYS             days of database dumps to keep (default 30)
#   BACKUP_AGE_RECIPIENT  age public key; when set, dumps are encrypted and the plain dump removed
#   BACKUP_REMOTE         rclone destination, e.g. cos:my-bucket/healthlog (use an rclone crypt
#                         remote to encrypt the attachment mirror too)
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

log() { echo "[$(date "+%FT%T%z")] $*"; }
die() { echo "[$(date "+%FT%T%z")] ✗ $*" >&2; exit 1; }

env_value() { # read KEY from .env without executing it; the last occurrence wins
    [ -f .env ] && grep -E "^$1=" .env | tail -n1 | cut -d= -f2- || true
}
KEEP_DAYS="${KEEP_DAYS:-$(env_value KEEP_DAYS)}"; KEEP_DAYS="${KEEP_DAYS:-30}"
AGE_RECIPIENT="${BACKUP_AGE_RECIPIENT:-$(env_value BACKUP_AGE_RECIPIENT)}"
REMOTE="${BACKUP_REMOTE:-$(env_value BACKUP_REMOTE)}"

[ -n "$(docker compose ps -q postgres 2>/dev/null)" ] || die "postgres 容器未运行（docker compose up -d）"
mkdir -p backup/db backup/storage

stamp="$(date +%Y%m%d-%H%M%S)"
dump="backup/db/healthlog-$stamp.dump"
log "pg_dump → $dump"
docker compose exec -T postgres pg_dump -U healthlog -d healthlog -Fc > "$dump.part"
mv "$dump.part" "$dump"
[ -s "$dump" ] || die "dump is empty"

if [ -n "$AGE_RECIPIENT" ]; then
    command -v age >/dev/null || die "BACKUP_AGE_RECIPIENT 已设置但没有安装 age（apt install age）"
    age -r "$AGE_RECIPIENT" -o "$dump.age" "$dump" && rm -f "$dump"
    log "encrypted → $dump.age"
fi

# Attachment files are write-once, so a mirror is effectively incremental. --delete keeps
# deleted health data from lingering in backups; older dumps may then reference missing files.
log "mirror attachments → backup/storage/"
rsync -a --delete data/storage/ backup/storage/

find backup/db -name 'healthlog-*.dump*' -mtime +"$KEEP_DAYS" -delete

if [ -n "$REMOTE" ]; then
    command -v rclone >/dev/null || die "BACKUP_REMOTE 已设置但没有安装 rclone"
    log "sync → $REMOTE"
    rclone sync backup/ "$REMOTE" --exclude '*.part'
fi
log "✓ backup done"
