#!/bin/sh
set -eu

# Migrations must finish before starting the API. The transaction lock makes
# initial provisioning safe when several API replicas start together.
if [ -n "${BOOTSTRAP_ADMIN_EMAIL:-}" ]; then
  node dist/maintenance/bootstrap-admin.js
fi

exec "$@"
