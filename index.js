import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  ActivityType,
  PermissionFlagsBits,
  EmbedBuilder
} from 'discord.js';
import { Shoukaku, Connectors } from 'shoukaku';

const {
  DISCORD_TOKEN,
  PREFIX = 'm!',
  LAVA_HOST = '127.0.0.1',
  LAVA_PORT = '2333',
  LAVA_PASSWORD
} = process.env;

const RESOLVED_LAVA_PASSWORD = LAVA_PASSWORD || process.env.LAVALINK_PASSWORD || 'youshallnotpass';
const EMBED_COLOR = 0x092a5e;

if (!DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN in env');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Channel]
});

function e(desc, title) {
  const eb = new EmbedBuilder().setColor(EMBED_COLOR).setDescription(String(desc));
  if (title) eb.setTitle(String(title));
  return { embeds: [eb] };
}

let llReady = false;

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

shoukaku.on('ready', (name) => { llReady = true; console.log(`[Lavalink] Node ${name} ready`); });
shoukaku.on('error', (_, err) => console.error('[Lavalink] Error:', err));
shoukaku.on('close', (name, code, reason) => { llReady = false; console.warn(`[Lavalink] ${name} closed (${code}) ${reason ?? ''}`); });
shoukaku.on('disconnect', (name, reason) => { llReady = false; console.warn(`[Lavalink] ${name} disconnected ${reason ?? ''}`); });

const queues = new Map(); // guildId -> { player, vcId, tracks: [], loop: false, current: null, channelId }

function isUrl(q) { try { new URL(q); return true; } catch { return false; } }

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
  const q = isUrl(query) ? query : `ytsearch:${query}`;
  return node.rest.resolve(q);
}

async function playNext(guildId) {
  const q = queues.get(guildId);
  if (!q) return;
  if (q.current && q.loop) q.tracks.unshift(q.current);
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
  if (channel?.isTextBased()) {
    channel.send(e(`Now playing: **${next.info.title}**`, 'Now Playing')).catch(() => {});
  }
}

client.once('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setActivity('TUI Music', { type: ActivityType.Watching });
});

function needVC(member) {
  const vc = member.voice?.channel;
  return vc || null;
}

function checkVCPerms(vc) {
  const perms = vc.permissionsFor(vc.guild.members.me);
  const missing = [];
  if (!perms?.has(PermissionFlagsBits.Connect)) missing.push('Connect');
  if (!perms?.has(PermissionFlagsBits.Speak)) missing.push('Speak');
  return missing;
}

client.on('messageCreate', async (msg) => {
  try {
    if (!msg.guild || msg.author.bot) return;
    if (!msg.content?.startsWith(PREFIX)) return;

    const [raw, ...args] = msg.content.slice(PREFIX.length).trim().split(/\s+/);
    const cmd = (raw || '').toLowerCase();

    const getQueue = (guildId) => {
      if (!queues.has(guildId)) queues.set(guildId, { player: null, vcId: null, tracks: [], loop: false, current: null, channelId: msg.channel.id });
      const q = queues.get(guildId);
      q.channelId = msg.channel.id;
      return q;
    };

    if (cmd === 'diag') {
      return msg.reply(e(
        [
          `Lavalink ready: ${llReady}`,
          `Node URL: ${process.env.LAVA_HOST || '127.0.0.1'}:${process.env.LAVA_PORT || '2333'}`,
          `Prefix: ${PREFIX}`,
          `Intents: Guilds, GuildMessages, MessageContent, GuildVoiceStates`
        ].join('\n'),
        'Diagnostics'
      ));
    }

    if (cmd === 'p' || cmd === 'play') {
      const member = await msg.guild.members.fetch(msg.author.id);
      const vc = needVC(member);
      if (!vc) return msg.reply(e('Join a voice channel first.', 'Voice Required'));

      const missing = checkVCPerms(vc);
      if (missing.length) return msg.reply(e(`I need these permissions in ${vc.name}: ${missing.join(', ')}`, 'Missing Permissions'));

      if (!llReady) return msg.reply(e('Audio backend not ready yet. Try again in a few seconds.', 'Please Wait'));

      const query = args.join(' ');
      if (!query) return msg.reply(e(`Usage: \`${PREFIX}play <query|url>\``, 'Usage'));

      let res;
      try { res = await search(query); }
      catch (e2) {
        console.error('Search error:', e2);
        return msg.reply(e('Search failed (backend unreachable or query invalid).', 'Search Error'));
      }
      if (!res || !res.tracks?.length) return msg.reply(e('No results found.', 'No Results'));

      const track = res.type === 'PLAYLIST' ? res.tracks[0] : res.tracks[0];
      const q = getQueue(msg.guild.id);

      try {
        if (!q.player) {
          q.player = await ensurePlayer(msg.guild, vc.id);
          q.vcId = vc.id;
          q.player.on('end', () => playNext(msg.guild.id));
          q.player.on('closed', () => queues.delete(msg.guild.id));
          q.player.on('exception', (e3) => { console.error('Player exception:', e3); playNext(msg.guild.id); });
        } else if (q.vcId !== vc.id) {
          await q.player.connection.moveChannel(vc.id);
          q.vcId = vc.id;
        }
      } catch (e4) {
        console.error('Join/move error:', e4);
        return msg.reply(e('I could not join your voice channel (permission/region/full).', 'Voice Error'));
      }

      q.tracks.push(track);
      await msg.reply(e(`Queued: **${track.info.title}**`, 'Queued'));
      if (!q.current) playNext(msg.guild.id);
      return;
    }

    if (cmd === 's' || cmd === 'stop') {
      const q = queues.get(msg.guild.id);
      if (!q) return msg.reply(e('Nothing to stop.', 'Stop'));
      q.tracks = [];
      q.loop = false;
      q.current = null;
      try { q.player.stopTrack(); } catch {}
      try { q.player.connection.disconnect(); } catch {}
      queues.delete(msg.guild.id);
      return msg.reply(e('Stopped and left the voice channel.', 'Stopped'));
    }

    if (cmd === 'pause') {
      const q = queues.get(msg.guild.id);
      if (!q || !q.current) return msg.reply(e('Nothing is playing.', 'Pause'));
      const paused = q.player.paused;
      await q.player.setPaused(!paused);
      return msg.reply(e(paused ? 'Resumed playback.' : 'Paused playback.', paused ? 'Resumed' : 'Paused'));
    }

    if (cmd === 'loop') {
      const q = queues.get(msg.guild.id);
      if (!q || !q.current) return msg.reply(e('Nothing is playing.', 'Loop'));
      q.loop = !q.loop;
      return msg.reply(e(q.loop ? 'Loop enabled for the current track.' : 'Loop disabled.', 'Loop'));
    }

    if (cmd === 'skip') {
      const q = queues.get(msg.guild.id);
      if (!q || !q.current) return msg.reply(e('Nothing to skip.', 'Skip'));
      try { q.player.stopTrack(); } catch {}
      return msg.reply(e('Skipped the current track.', 'Skipped'));
    }
  } catch (err) {
    console.error('Handler error:', err);
    try { await msg.reply(e('Error processing command.', 'Error')); } catch {}
  }
});

client.login(DISCORD_TOKEN);
