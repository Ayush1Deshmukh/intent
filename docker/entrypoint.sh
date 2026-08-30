#!/bin/sh
# Bring the database up to date, then start the server.
#
# setup.cjs is compiled at build time and is idempotent: it applies only the
# migrations that have not run, and only seeds reference data that is missing. So
# `docker compose up` behaves the same on the first run and on the tenth.
set -e
node setup.cjs
echo "verified-tape · listening on port ${PORT:-3000}"
exec "$@"
