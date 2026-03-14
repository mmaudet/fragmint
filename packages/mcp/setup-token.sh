#!/usr/bin/env bash
set -euo pipefail

FRAGMINT_URL="${FRAGMINT_URL:-http://localhost:3210}"
SETTINGS="$HOME/.claude/settings.json"

echo "==> Login as mmaudet (dev user)..."
JWT=$(curl -sf -X POST "$FRAGMINT_URL/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"mmaudet","password":"fragmint-dev"}' \
  | jq -r '.data.token')

if [ -z "$JWT" ] || [ "$JWT" = "null" ]; then
  echo "ERROR: Login failed. Is the server running on $FRAGMINT_URL in dev mode?"
  exit 1
fi
echo "    JWT obtained."

echo "==> Creating API token 'claude-code-mcp'..."
RESPONSE=$(curl -sf -X POST "$FRAGMINT_URL/v1/tokens" \
  -H "Authorization: Bearer $JWT" \
  -H 'Content-Type: application/json' \
  -d '{"name":"claude-code-mcp","role":"admin"}')

TOKEN=$(echo "$RESPONSE" | jq -r '.data.token')

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "ERROR: Token creation failed."
  echo "$RESPONSE" | jq .
  exit 1
fi
echo "    Token: $TOKEN"

echo "==> Updating $SETTINGS..."
ESCAPED_TOKEN=$(printf '%s' "$TOKEN" | sed 's/[&/\]/\\&/g')
sed -i '' "s/YOUR_TOKEN_HERE/$ESCAPED_TOKEN/" "$SETTINGS"

echo "==> Done! Restart your Claude Code sessions to pick up the new MCP config."
