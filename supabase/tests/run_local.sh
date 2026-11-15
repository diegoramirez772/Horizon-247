#!/usr/bin/env bash
# Prueba las migraciones en un Postgres local desechable (no toca Supabase).
# Uso: bash supabase/tests/run_local.sh      (necesita postgresql 15+ instalado)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"
DIR="$(mktemp -d)"; PORT=55447
AS=()
if [ "$(id -u)" = "0" ]; then AS=(runuser -u postgres --); chown postgres "$DIR"; chmod 755 "$HERE" "$HERE/../migrations"; fi   # initdb no corre como root
trap '"${AS[@]}" "$BIN/pg_ctl" -D "$DIR" stop -m fast >/dev/null 2>&1 || true; rm -rf "$DIR"' EXIT
"${AS[@]}" "$BIN/initdb" -D "$DIR" -U postgres -A trust >/dev/null
"${AS[@]}" "$BIN/pg_ctl" -D "$DIR" -o "-p $PORT -k $DIR -c listen_addresses=''" -l "$DIR/log" start >/dev/null
PSQL=("${AS[@]}" psql -h "$DIR" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -c "create database hz"
"${PSQL[@]}" -d hz -f "$HERE/local_supabase_shim.sql"
for f in "$HERE"/../migrations/*.sql; do echo "migración: $(basename "$f")"; "${PSQL[@]}" -d hz -f "$f"; done
"${PSQL[@]}" -d hz -f "$HERE/test_horizon.sql"
