#!/usr/bin/env bash
set -e

echo "[start] LAVALINK_PASSWORD=${LAVALINK_PASSWORD:-youshallnotpass}"
java -jar /app/lavalink/Lavalink.jar &
LAVA_PID=$!

echo "[start] Waiting for Lavalink on 127.0.0.1:2333..."
for i in $(seq 1 60); do
  if nc -z 127.0.0.1 2333; then
    echo "[start] Lavalink is up."
    break
  fi
  sleep 1
done

echo "[start] Starting Discord bot..."
node /app/index.js

kill $LAVA_PID || true
wait $LAVA_PID || true
