// TUI Music Bot – single-file, prefix commands (bundled Lavalink via Docker)
import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  ActivityType
} from 'discord.js';
import { Shoukaku, Connectors } from 'shoukaku';

const {
  DISCORD_TOKEN,
  PREFIX = 'm!',
  LAVA_HOST = 'localhost',
  LAVA_PORT = '2333',
  LAVA_PASSWORD
} = process.env;

const RESOLVED_LAVA_PASSWORD = LAVA_PASSWORD || process.env.LAVALINK_PASSWORD || 'youshallnotpass';

if (!DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN in .env / environment');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // enable in Dev Portal
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Channel]
});

// ---- Lavalink (Shoukaku) ----
const Nodes = [{
  name: 'main',
  url: `${LAVA_HOST}:${LAVA_PORT}`,
  auth: RESOLVED_LAVA_PASSWORD,
  secure: false
}];

const shoukaku = new Shoukaku(new Connectors.DiscordJS(client), Nodes, {
  moveOnDisconnect: true,
  resumable: true,
  resumableKey: 'tui-music',
  resumableTimeout: 60
});

shoukaku.on('ready', (name) => console.log(`[Lavalink] Node ${name} ready`));
shoukaku.on('error', (_, err) => console.error('[Lavalink] Error:', err));
shoukaku.on('close', (name, code, reason) => console.warn(`[Lavalink] ${name} closed (${code}) ${reason ?? ''}`));
shoukaku.on('disconnect', (name, reason) => console.warn(`[Lavalink] ${name} disconnected ${reason ?? ''}`));

// ---- Simple in-memory queue per guild ----
const queues = new Map(); // guildId -> { player, vcId, tracks: [], loop: false, current: null, channelId }

function isUrl(q) {
  try { new URL(q); return true; } catch { return false; }
}

async function ensurePlayer(guild, voiceChannelId) {
  const node = shoukaku.getNode();
  const player = await node.joinChannel({
    guildId: guild.id,
    channelId: voiceChannelId,
    shardId: guild.shardId,
    deaf: true
  });
  return player;
}

async function search(query) {
  const node = shoukaku.getNode();
  const q = isUrl(query) ? query : `ytsearch:${query}`; // LavaSrc handles more providers if installed
  return node.rest.resolve(q);
}

async function playNext(guildId) {
  const q = queues.get(guildId);
  if (!q) return;
  if (q.current && q.loop) {
    q.tracks.unshift(q.current);
  }
  const next = q.tracks.shift();
  if (!next) {
    q.current = null;
    try { q.player.connection.disconnect(); } catch {}
    queues.delete(guildId);
    return;
  }
  q.current = next;
  await q.player.playTrack(next.encoded);
  const channel = client.channels.cache.get(q.channelId);
  if (channel && channel.isTextBased()) {
    channel.send(`▶️ Now playing: **${next.info.title}**`).catch(() => {});
  }
}

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setActivity('TUI Music', { type: ActivityType.Watching });
});

client.on('messageCreate', async (msg) => {
  if (!msg.guild || msg.author.bot) return;
  if (!msg.content.startsWith(PREFIX)) return;

  const [cmd, ...args] = msg.content.slice(PREFIX.length).trim().split(/\s+/);
  const name = cmd?.toLowerCase();

  const getQueue = (guildId) => {
    if (!queues.has(guildId)) queues.set(guildId, { player: null, vcId: null, tracks: [], loop: false, current: null, channelId: msg.channel.id });
    const q = queues.get(guildId);
    q.channelId = msg.channel.id;
    return q;
  };

  try {
    if (name === 'p' || name === 'play') {
      const me = await msg.guild.members.fetch(msg.author.id);
      const vc = me.voice?.channel;
      if (!vc) return msg.reply('Join a voice channel first.');

      const query = args.join(' ');
      if (!query) return msg.reply(`Usage: \`${process.env.PREFIX || 'm!'}play <query|url>\``);

      const res = await search(query);
      if (!res || !res.tracks?.length) return msg.reply('No results found.');

      const track = res.type === 'PLAYLIST' ? res.tracks[0] : res.tracks[0];

      const q = getQueue(msg.guild.id);
      if (!q.player) {
        q.player = await ensurePlayer(msg.guild, vc.id);
        q.vcId = vc.id;

        q.player.on('end', () => playNext(msg.guild.id));
        q.player.on('closed', () => queues.delete(msg.guild.id));
        q.player.on('exception', (e) => {
          console.error('Player exception:', e);
          playNext(msg.guild.id);
        });
      } else if (q.vcId !== vc.id) {
        await q.player.connection.moveChannel(vc.id);
        q.vcId = vc.id;
      }

      q.tracks.push(track);
      await msg.reply(`🎵 Queued: **${track.info.title}**`);

      if (!q.current) playNext(msg.guild.id);
      return;
    }

    if (name === 's' || name === 'stop') {
      const q = queues.get(msg.guild.id);
      if (!q) return msg.reply('Nothing to stop.');
      q.tracks = [];
      q.loop = false;
      q.current = null;
      try { q.player.stopTrack(); } catch {}
      try { q.player.connection.disconnect(); } catch {}
      queues.delete(msg.guild.id);
      return msg.reply('⏹️ Stopped and left.');
    }

    if (name === 'pause') {
      const q = queues.get(msg.guild.id);
      if (!q || !q.current) return msg.reply('Nothing is playing.');
      const paused = q.player.paused;
      await q.player.setPaused(!paused);
      return msg.reply(paused ? '▶️ Resumed.' : '⏸️ Paused.');
    }

    if (name === 'loop') {
      const q = queues.get(msg.guild.id);
      if (!q || !q.current) return msg.reply('Nothing is playing.');
      q.loop = !q.loop;
      return msg.reply(q.loop ? '🔁 Loop enabled (current track).' : '➡️ Loop disabled.');
    }

    if (name === 'skip') {
      const q = queues.get(msg.guild.id);
      if (!q || !q.current) return msg.reply('Nothing to skip.');
      try { q.player.stopTrack(); } catch {}
      return msg.reply('⏭️ Skipped.');
    }
  } catch (err) {
    console.error(err);
    try { await msg.reply('⚠️ Error processing command.'); } catch {}
  }
});

client.login(DISCORD_TOKEN);
