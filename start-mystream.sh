#!/usr/bin/env sh
# MyStream development launcher for Linux/macOS. Needs Node.js 22+.
cd "$(dirname "$0")"
[ -f .env ] || { cp .env.example .env; echo "Created .env - add your TMDB_API_KEY and run again."; exit 1; }
exec node services/api/src/server.js
