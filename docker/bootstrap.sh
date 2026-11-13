#!/bin/sh
# Entrypoint of the n8n container in docker-compose.yml.
# First start only: create the credentials from the environment, import and
# publish the four workflows, then call the setup webhook once n8n is up so
# the data tables exist. Later starts leave your edits alone.
set -eu

MARK=/home/node/.n8n/.events-newsletter-imported

if [ -f "$MARK" ]; then
  exec n8n start
fi

STAGE=$(mktemp -d)
node /bootstrap/prepare.mjs /bootstrap/workflows "$STAGE"
n8n import:credentials --input="$STAGE/credentials.json"
n8n import:workflow --separate --input="$STAGE/workflows"
# The sub-workflow first, then the ones that call it.
for id in eventsNewsSetup01 eventsNewsExtrct1 eventsNewsWeekly1 eventsNewsRunNow1; do
  n8n publish:workflow --id="$id"
done
rm -rf "$STAGE"

n8n start &
N8N=$!
trap 'kill -TERM "$N8N" 2>/dev/null' TERM INT

# Data tables can only be created by a running n8n, so they are made through
# the setup workflow's webhook.
tries=0
until wget -q -O /dev/null --header="X-Newsletter-Key: $NEWSLETTER_KEY" --header="Content-Type: application/json" \
  --post-data='{}' http://127.0.0.1:5678/webhook/newsletter/setup 2>/dev/null; do
  tries=$((tries + 1))
  if [ "$tries" -gt 90 ] || ! kill -0 "$N8N" 2>/dev/null; then
    echo "events-newsletter: could not create the data tables" >&2
    kill -TERM "$N8N" 2>/dev/null || true
    exit 1
  fi
  sleep 2
done
touch "$MARK"
echo "events-newsletter: workflows published and data tables created"

wait "$N8N"
