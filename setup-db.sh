#!/bin/bash
# Setup PostgreSQL for opendownload
set -e

PGDATA="$(dirname "$0")/pgdata"

if [ ! -d "$PGDATA" ]; then
  echo "Initializing PostgreSQL..."
  pg_ctl -D "$PGDATA" initdb
fi

echo "Starting PostgreSQL..."
pg_ctl -D "$PGDATA" -l "$PGDATA/logfile" start

echo "Creating database..."
createdb opendownload 2>/dev/null || echo "Database may already exist"

echo "Running migrations..."
node src/db/migrate.js

echo "Done! Run 'npm start' to start the server."
