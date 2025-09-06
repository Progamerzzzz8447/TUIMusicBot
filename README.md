# TUI Music Bot – All-in-one (Docker) v3
All bot messages use **embeds** with color **#092a5e**, and **no emojis**.

## Commands
- `m!p` / `m!play <query|url>`
- `m!s` / `m!stop`
- `m!pause`
- `m!loop`
- `m!skip`
- `m!diag` — prints backend status & checks

Presence: **Watching TUI Music**

## ENV
- `DISCORD_TOKEN` (required)
- `PREFIX` (default `m!`)
- `LAVALINK_PASSWORD` (default `youshallnotpass`)
- `LAVA_HOST=127.0.0.1` (inside container)
- `LAVA_PORT=2333`

## Deploy
- Push to GitHub → Deploy as a Docker **Background Worker** (Render/Railway).
- Set env vars in dashboard and deploy.

## Notes
- To add Spotify link support later, add the LavaSrc plugin to Lavalink and adjust config.
