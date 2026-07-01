#!/bin/sh
set -e

echo "[api] Waiting for database and applying schema..."
npx prisma db push --skip-generate --accept-data-loss

# No seed on the default startup path: a fresh database must contain no
# application data. Seed data can still be loaded manually with `npm run seed`.

echo "[api] Starting HTTP API on port ${PORT:-3000}..."
exec node dist/index.js
