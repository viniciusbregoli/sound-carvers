#!/usr/bin/env bash
# Replaces the MCP Bearer token without printing it. The server reads the file on every request,
# so the old token stops working immediately and nothing needs a restart.
# Afterwards, give the new token to the MCP client (Saga): it is in the file below (mode 600).
set -euo pipefail
dir="${MCP_TOKEN_DIR:-$HOME/.config/soundcarvers-setlist-mcp}"
umask 077
mkdir -p "$dir"
chmod 700 "$dir"
tmp="$(mktemp "$dir/.token.XXXXXX")"
openssl rand -hex 32 >"$tmp"
chmod 600 "$tmp"
# Same directory, so the rename is atomic: readers see the old token or the new one, never a partial file.
mv -f "$tmp" "$dir/token"
echo "New MCP token written to $dir/token (not shown). Update the client's Authorization header."
