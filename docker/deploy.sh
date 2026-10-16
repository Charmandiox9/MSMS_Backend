#!/bin/sh
set -eu

# Dokploy terminals may open in /; always resolve the bundled CLI from /app.
cd /app
printf '%s\n' '[deployment] Applying pending database migrations.'
node node_modules/prisma/build/index.js migrate deploy

# set -e prevents bootstrap and API startup if migration fails. No npm download.
printf '%s\n' '[deployment] Database migrations complete; starting application.'
exec /bin/sh /app/docker/start.sh "$@"
