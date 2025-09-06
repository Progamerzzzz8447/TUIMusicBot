#!/usr/bin/env bash
set -e

echo "[start] Using LAVALINK_PASSWORD=${LAVALINK_PASSWORD:-youshallnotpass}"

# Ensure application.yml has current password (uses env var interpolation default in YAML)
echo "[start] Launching Lavalink..."
java -jar /app/lavalink/Lavalink.jar &
LAVA_PID=$!

# Wait for Lavalink to start accepting connections (simple wait loop)
echo "[start] Waiting for Lavalink on 127.0.0.1:2333 ..."
for i in {1..60}; do
  if (echo > /dev/tcp/127.0.0.1/2333) >/dev/null 2>&1; then
    echo "[start] Lavalink is up."
    break
  fi
  sleep 1
done

echo "[start] Starting Discord bot..."
node /app/index.js

# In case node exits, stop Lavalink too
kill $LAVA_PID || true
wait $LAVA_PID || true
