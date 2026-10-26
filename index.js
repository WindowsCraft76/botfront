require('dotenv').config({ quiet: true });
const { AsyncLocalStorage } = require('node:async_hooks');
const {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder,
  MessageFlags, ActivityType, ActionRowBuilder, ButtonBuilder, ButtonStyle, escapeMarkdown,
  version: DISCORD_JS_VERSION
} = require('discord.js');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = LEVELS[(process.env.LOG_LEVEL ?? 'info').toLowerCase()] ?? LEVELS.info;
const USE_COLOR = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const COLORS = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' };
const RESET = '\x1b[0m';

const traceStore = new AsyncLocalStorage();

const fmtMeta = (meta) =>
  Object.entries(meta ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => {
      const str = String(v);
      return `${k}=${/\s/.test(str) ? JSON.stringify(str) : str}`;
    })
    .join(' ');

function emit(level, scope, message, meta, error) {
  if (LEVELS[level] < MIN_LEVEL) return;

  const trace = traceStore.getStore();
  const parts = [
    new Date().toISOString(),
    level.toUpperCase().padEnd(5),
    `[${scope}]`,
    trace ? `#${trace.id}` : null,
    message,
    fmtMeta(meta)
  ].filter(Boolean);

  let line = parts.join(' ');
  if (USE_COLOR) line = `${COLORS[level]}${line}${RESET}`;

  const out = level === 'warn' || level === 'error' ? console.error : console.log;
  out(line);
  if (error?.stack) out(error.stack);
}

const log = {
  debug: (scope, msg, meta) => emit('debug', scope, msg, meta),
  info: (scope, msg, meta) => emit('info', scope, msg, meta),
  warn: (scope, msg, meta, err) => emit('warn', scope, msg, meta, err),
  error: (scope, msg, meta, err) => emit('error', scope, msg, meta, err)
};

const setOutcome = (outcome) => {
  const store = traceStore.getStore();
  if (store) store.outcome = outcome;
};

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const API_KEY = process.env.BLOCKFRONT_API_KEY;
const API_URL = process.env.BLOCKFRONT_API_URL;

const missingEnv = Object.entries({
  TOKEN, CLIENT_ID, BLOCKFRONT_API_URL: API_URL, BLOCKFRONT_API_KEY: API_KEY
}).filter(([, value]) => !value).map(([name]) => name);

if (missingEnv.length > 0) {
  log.error('BOOT', 'Missing environment variables', { missing: missingEnv.join(',') });
  throw new Error('TOKEN, CLIENT_ID, BLOCKFRONT_API_URL and BLOCKFRONT_API_KEY must be defined !');
}

const API_TIMEOUT = 10_000;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Shows the bot and BlockFront API latency.'),
  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Shows the stats of a BlockFront player.')
    .addStringOption(option =>
      option.setName('name')
        .setDescription('Player name')
        .setRequired(true)
        .setMaxLength(16)
    ),
  new SlashCommandBuilder()
    .setName('clan')
    .setDescription('Shows the info of a BlockFront clan.')
    .addStringOption(option =>
      option.setName('tag')
        .setDescription('Clan tag')
        .setRequired(true)
        .setMaxLength(5)
    ),
  new SlashCommandBuilder()
    .setName('scoreboard')
    .setDescription('Shows the BlockFront monthly scoreboard.')
    .addSubcommand(sub =>
      sub.setName('players').setDescription('Monthly players scoreboard.')
    )
    .addSubcommand(sub =>
      sub.setName('clans').setDescription('Monthly clans scoreboard.')
    ),
  new SlashCommandBuilder()
    .setName('rules')
    .setDescription('Shows the offcial BlockFront rules.')
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

async function registerCommands() {
  const start = performance.now();
  log.info('BOOT', `Registering ${commands.length} global slash commands`, {
    commands: commands.map(c => c.name).join(',')
  });

  try {
    const registered = await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );
    log.info('BOOT', 'Slash commands registered', {
      registered: registered.length,
      duration: `${Math.round(performance.now() - start)}ms`
    });
  } catch (error) {
    log.error('BOOT', 'Slash command registration FAILED (previously registered commands stay active)', {
      status: error.status,
      code: error.code,
      duration: `${Math.round(performance.now() - start)}ms`
    }, error);
  }
}

let customEmojis = new Map();

async function loadRankEmojis() {
  const start = performance.now();
  const emojis = await client.application.emojis.fetch();
  customEmojis = new Map(emojis.map(e => [e.name, e.toString()]));
  log.info('BOOT', 'Application emojis loaded', {
    count: customEmojis.size,
    duration: `${Math.round(performance.now() - start)}ms`
  });
}

const rankEmoji = (rank) =>
  rank?.id != null ? (customEmojis.get(`${rank.id}_rank`) ?? '') : '';

const skillEmoji = (skill) => {
  if (!skill) return '';

  const raw = String(skill).trim().toLowerCase();
  if (raw === 'unranked') return customEmojis.get('none') ?? '';

  const parts = raw.split(/\s+/);
  const direct = parts.join('_');
  const reversed = [...parts].reverse().join('_');

  return customEmojis.get(direct) ?? customEmojis.get(reversed) ?? '';
};

const classEmoji = (id) =>
  id != null ? (customEmojis.get(`${id}_class`) ?? customEmojis.get(`unknown_class`)) : '';

client.once('clientReady', async () => {
  log.info('BOOT', `Logged in as ${client.user.tag}`, {
    id: client.user.id,
    guilds: client.guilds.cache.size,
    ws: `${Math.round(client.ws.ping)}ms`,
    startup: `${process.uptime().toFixed(1)}s`
  });

  try {
    await loadRankEmojis();
  } catch (error) {
    log.error('BOOT', 'Could not load application emojis', { error: error.message }, error);
  }

  await updatePresence();
  setInterval(updatePresence, 60_000);
  log.info('BOOT', 'Bot is ready and listening for interactions');
});

client.on('shardReady', (id, unavailable) =>
  log.info('GATEWAY', `Shard ${id} ready`, { unavailableGuilds: unavailable?.size ?? 0 }));
client.on('shardDisconnect', (event, id) =>
  log.warn('GATEWAY', `Shard ${id} disconnected`, { code: event?.code }));
client.on('shardReconnecting', (id) =>
  log.warn('GATEWAY', `Shard ${id} reconnecting...`));
client.on('shardResume', (id, replayed) =>
  log.info('GATEWAY', `Shard ${id} resumed`, { replayedEvents: replayed }));
client.on('shardError', (error, id) =>
  log.error('GATEWAY', `Shard ${id} error`, { error: error.message }, error));
client.on('warn', (message) => log.warn('DISCORD', message));
client.on('error', (error) => log.error('DISCORD', 'Client error', { error: error.message }, error));
client.on('guildCreate', (guild) =>
  log.info('GUILD', `Joined guild ${guild.name}`, { id: guild.id, members: guild.memberCount }));
client.on('guildDelete', (guild) =>
  log.info('GUILD', `Left guild ${guild.name ?? 'unknown'}`, { id: guild.id }));

client.rest.on('rateLimited', (info) =>
  log.warn('DISCORD', 'Discord REST rate limited', {
    method: info.method,
    route: info.route,
    limit: info.limit,
    retryAfter: `${info.timeToReset}ms`,
    global: info.global
  }));

process.on('unhandledRejection', (reason) =>
  log.error('PROCESS', 'Unhandled promise rejection', {
    error: reason?.message ?? String(reason)
  }, reason instanceof Error ? reason : undefined));

process.on('uncaughtException', (error) => {
  log.error('PROCESS', 'Uncaught exception, exiting', { error: error.message }, error);
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    log.info('PROCESS', `Received ${signal}, shutting down`, {
      uptime: `${Math.round(process.uptime())}s`
    });
    try { await client.destroy(); } catch { }
    process.exit(0);
  });
}

const fmt = (n, digits = 0) =>
  Number(n ?? 0).toLocaleString('en-US', { maximumFractionDigits: digits });

const pct = (ratio) => `${(Number(ratio ?? 0) * 100).toFixed(1)}%`;

const formatTime = (seconds) => {
  const total = Math.floor(Number(seconds / 60 ?? 0));
  return `${fmt(total)}h`;
};

const formatBootcamp = (value) => {
  return value > 0.0 ? `Yes` : `No`;
};

async function apiFetch(type, params = {}, { timeout = API_TIMEOUT, quiet = false } = {}) {
  const query = Object.entries(params)
    .map(([key, value]) => `&${key}=${encodeURIComponent(value)}`)
    .join('');
  const url = `${API_URL}?type=${type}${query}`;

  log.debug('API', `GET ${type}`, params);
  const start = performance.now();

  try {
    const res = await fetch(url, {
      headers: { 'X-API-Key': API_KEY },
      signal: AbortSignal.timeout(timeout)
    });
    const duration = `${Math.round(performance.now() - start)}ms`;

    const level = res.ok ? (quiet ? 'debug' : 'info') : (res.status === 404 ? 'info' : 'warn');
    log[level]('API', `GET ${type} -> ${res.status}`, { ...params, duration });
    return res;
  } catch (error) {
    const reason = error.name === 'TimeoutError' ? `timeout after ${timeout}ms` : 'network error';
    log.warn('API', `GET ${type} failed (${reason})`, {
      ...params,
      duration: `${Math.round(performance.now() - start)}ms`,
      error: error.message,
      cause: error.cause?.code
    });
    throw error;
  }
}

async function fetchPlayer(name) {
  const res = await apiFetch('player', { name });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API error ${res.status}`);

  return res.json();
}

async function fetchClan(tag) {
  const res = await apiFetch('clan', { tag });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API error ${res.status}`);

  return res.json();
}

const ROLE_ICONS = { owner: '👑', officer: '⭐' };
const ROLE_ORDER = { owner: 0, officer: 1, member: 2 };

function chunkLines(lines, max = 1024) {
  const chunks = [];
  let current = '';
  for (const line of lines) {
    if (current && current.length + line.length + 1 > max) {
      chunks.push(current);
      current = '';
    }
    current += (current ? '\n' : '') + line;
  }
  if (current) chunks.push(current);
  return chunks;
}

function buildClanEmbed(clan) {
  const allMembers = clan.members ?? [];
  const owner = allMembers.find(m => m.role === 'owner');

  const sorted = [...allMembers].sort((a, b) =>
    (ROLE_ORDER[a.role] ?? 3) - (ROLE_ORDER[b.role] ?? 3) ||
    (b.rank?.id ?? 0) - (a.rank?.id ?? 0)
  );

  const lines = sorted.map(m =>
    [rankEmoji(m.rank), ROLE_ICONS[m.role], escapeMarkdown(m.username)]
      .filter(Boolean)
      .join(' ')
  );

  const embed = new EmbedBuilder()
    .setColor(0x00B297)
    .setTitle(`[${clan.tag}] ${clan.name}`)
    .setDescription(
      `**Skill rank:** ${clan.skillRank?.title ?? 'N/A'} ${skillEmoji(clan.skillRank?.title)}\n` +
      `**Owner:** ${owner ? escapeMarkdown(owner.username) : 'N/A'}\n` +
      `**Founded:** ${clan.founded ? `<t:${Math.floor(clan.founded / 1000)}:D>` : 'N/A'}\n` +
      `**Members:** ${fmt(clan.memberCount)}\n` +
      `**Monthly score:** ${fmt(clan.score?.monthly)}\n` +
      `**Monthly rank:** #${fmt(clan.score?.rank)}`
    )
    .setFooter({ text: `Clan ID: ${clan.id}` })
    .setTimestamp();

  chunkLines(lines).forEach((chunk, i) => {
    embed.addFields({
      name: i === 0 ? `Members:` : '\u200b',
      value: chunk,
      inline: true
    });
  });

  return embed;
}

async function replyWithClan(interaction, tag) {
  try {
    const clan = await fetchClan(tag);

    if (!clan) {
      setOutcome('not_found');
      log.info('CMD', 'Clan not found', { tag });
      return interaction.editReply({ content: `❌ Clan **${escapeMarkdown(tag)}** not found.` });
    }

    await interaction.editReply({ embeds: [buildClanEmbed(clan)] });
    log.info('CMD', 'Clan info sent', {
      tag: clan.tag,
      id: clan.id,
      members: clan.memberCount
    });
  } catch (error) {
    setOutcome('error');
    log.error('CMD', 'Failed to fetch/send clan info', { tag, error: error.message }, error);
    await interaction.editReply({ content: '❌ Could not fetch clan info, try again later.' });
  }
}

const SCOREBOARD_PAGE_SIZE = 15;
const SCOREBOARD_CACHE_TTL = 120_000;
let scoreboardCache = { data: null, fetchedAt: 0 };

async function fetchScoreboard() {
  const now = Date.now();
  const age = now - scoreboardCache.fetchedAt;

  if (scoreboardCache.data && age < SCOREBOARD_CACHE_TTL) {
    log.debug('CACHE', 'Scoreboard cache HIT', { age: `${Math.round(age / 1000)}s` });
    return scoreboardCache.data;
  }

  log.debug('CACHE', 'Scoreboard cache MISS', {
    reason: scoreboardCache.data ? 'expired' : 'empty'
  });

  try {
    const res = await apiFetch('scoreboard');
    if (!res.ok) throw new Error(`API error ${res.status}`);

    scoreboardCache = { data: await res.json(), fetchedAt: now };
    log.info('CACHE', 'Scoreboard cache refreshed', {
      players: scoreboardCache.data.players?.length ?? 0,
      clans: scoreboardCache.data.clans?.length ?? 0
    });
  } catch (error) {
    if (!scoreboardCache.data) throw error;
    log.warn('CACHE', 'Scoreboard refresh failed, serving STALE cached data', {
      error: error.message,
      age: `${Math.round(age / 1000)}s`
    });
  }

  return scoreboardCache.data;
}

const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };

function buildScoreboardView(data, type, requestedPage) {
  const entries = data[type] ?? [];
  const totalPages = Math.max(1, Math.ceil(entries.length / SCOREBOARD_PAGE_SIZE));
  const page = Math.min(Math.max(0, requestedPage), totalPages - 1);

  if (page !== requestedPage) {
    log.debug('CMD', 'Scoreboard page clamped', { requested: requestedPage, used: page, totalPages });
  }

  const slice = entries.slice(
    page * SCOREBOARD_PAGE_SIZE,
    (page + 1) * SCOREBOARD_PAGE_SIZE
  );

  const ranks = slice.map(e => MEDALS[e.rank] ?? `**#${e.rank}**`);
  const names = slice.map(e =>
    e.hidden ? '*Hidden player*' : escapeMarkdown(String(e.name))
  );
  const scores = slice.map(e => `**${fmt(e.score)}**`);

  const column = (lines) => lines.join('\n') || '\u200b';

  const isPlayers = type === 'players';
  const embed = new EmbedBuilder()
    .setColor(isPlayers ? 0x70A641 : 0x00B297)
    .setTitle(isPlayers ? '🏆 Monthly players scoreboard' : '🏆 Monthly clans scoreboard')
    .setDescription(
      data.resetTime ? `Resets <t:${Math.floor(data.resetTime / 1000)}:R>` : null
    )
    .addFields(
      { name: 'Rank', value: column(ranks), inline: true },
      { name: isPlayers ? 'Name' : 'Tag', value: column(names), inline: true },
      { name: 'Score', value: column(scores), inline: true }
    )
    .setFooter({ text: `Page ${page + 1}/${totalPages}` })
    .setTimestamp(data.generatedAt ?? Date.now());

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`sb:${type}:${page - 1}`)
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`sb:${type}:${page + 1}`)
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page >= totalPages - 1)
  );

  log.info('CMD', 'Scoreboard view built', {
    type, page: `${page + 1}/${totalPages}`, rows: slice.length, totalEntries: entries.length
  });

  return { embeds: [embed], components: [row] };
}

const RULES_CACHE_TTL = 600_000;
let rulesCache = { data: null, fetchedAt: 0 };

async function fetchRules() {
  const now = Date.now();
  const age = now - rulesCache.fetchedAt;

  if (rulesCache.data && age < RULES_CACHE_TTL) {
    log.debug('CACHE', 'Rules cache HIT', { age: `${Math.round(age / 1000)}s` });
    return rulesCache.data;
  }

  log.debug('CACHE', 'Rules cache MISS', { reason: rulesCache.data ? 'expired' : 'empty' });

  try {
    const res = await apiFetch('rules');
    if (!res.ok) throw new Error(`API error ${res.status}`);

    rulesCache = { data: await res.json(), fetchedAt: now };
    log.info('CACHE', 'Rules cache refreshed', {
      rules: Object.keys(rulesCache.data ?? {}).length
    });
  } catch (error) {
    if (!rulesCache.data) throw error;
    log.warn('CACHE', 'Rules refresh failed, serving STALE cached data', {
      error: error.message,
      age: `${Math.round(age / 1000)}s`
    });
  }

  return rulesCache.data;
}

function buildRulesEmbed(rules) {
  const list = Object.values(rules ?? {}).sort((a, b) => a.id - b.id);

  const embed = new EmbedBuilder()
    .setColor(0x70A641)
    .setTitle('📜 Official BlockFront Rules')
    .setTimestamp();

  list.forEach((rule, i) => {
    embed.addFields({
      name: `${i + 1}. ${rule.title}`,
      value: String(rule.description ?? 'N/A').slice(0, 1024),
      inline: false
    });
  });

  return embed;
}

async function fetchPlayerCount() {
  const res = await apiFetch('player_count', {}, { quiet: true });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const data = await res.json();
  return Number(data.playersOnline ?? 0);
}

let lastPresence = null;

async function updatePresence() {
  let name;
  let status;

  try {
    const count = await fetchPlayerCount();
    name = `${fmt(count)} players online`;
    status = 'online';
  } catch (error) {
    name = `Cloud is down!`;
    status = 'inactive';
    if (lastPresence?.status !== status) {
      log.warn('PRESENCE', 'Could not fetch player count, switching to fallback presence', {
        error: error.message
      });
    } else {
      log.debug('PRESENCE', 'Player count still unavailable', { error: error.message });
    }
  }

  client.user.setPresence({
    activities: [{ name, type: ActivityType.Watching }],
    status
  });

  if (lastPresence?.name !== name || lastPresence?.status !== status) {
    log.info('PRESENCE', 'Presence updated', { status, activity: name });
  } else {
    log.debug('PRESENCE', 'Presence unchanged', { status, activity: name });
  }
  lastPresence = { name, status };
}

async function pingBlockFrontApi() {
  const start = performance.now();
  try {
    const res = await apiFetch('version', {}, { timeout: 5000 });
    const latency = Math.round(performance.now() - start);

    if (!res.ok) {
      return { ok: false, latency, status: res.status, players: null };
    }

    await res.json();
    return {
      ok: true,
      latency,
      status: res.status
    };
  } catch (error) {
    return {
      ok: false,
      latency: Math.round(performance.now() - start),
      status: error.name === 'TimeoutError' ? 'Timeout' : 'Unreachable'
    };
  }
}

const formatUptime = (ms) => {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return [d && `${d}d`, (d || h) && `${h}h`, `${m}m`].filter(Boolean).join(' ');
};

const latencyIcon = (ms) => (ms < 200 ? '🟢' : ms < 500 ? '🟠' : '🔴');

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW = 2 * 60 * 1000;
const userRequests = new Map();

function checkRateLimit(userId) {
  const now = Date.now();
  const timestamps = (userRequests.get(userId) ?? []).filter(t => now - t < RATE_LIMIT_WINDOW);

  if (timestamps.length >= RATE_LIMIT_MAX) {
    userRequests.set(userId, timestamps);
    return RATE_LIMIT_WINDOW - (now - timestamps[0]);
  }

  timestamps.push(now);
  userRequests.set(userId, timestamps);
  log.debug('RATELIMIT', 'Request counted', { user: userId, used: `${timestamps.length}/${RATE_LIMIT_MAX}` });
  return 0;
}

setInterval(() => {
  const now = Date.now();
  for (const [userId, timestamps] of userRequests) {
    const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW);
    if (recent.length === 0) userRequests.delete(userId);
    else userRequests.set(userId, recent);
  }
}, 60_000);

client.on('interactionCreate', (interaction) => {
  if (!interaction.isChatInputCommand() && !interaction.isButton()) return;

  const store = {
    id: interaction.id.slice(-6),
    outcome: 'ok',
    start: performance.now()
  };

  return traceStore.run(store, () => handleInteraction(interaction, store));
});

async function handleInteraction(interaction, store) {
  const label = interaction.isButton()
    ? `button ${interaction.customId}`
    : interaction.toString();

  const receivedDelay = Date.now() - interaction.createdTimestamp;
  log.info('CMD', `Received ${label}`, {
    user: `${interaction.user.tag}(${interaction.user.id})`,
    guild: interaction.guild ? `${interaction.guild.name}(${interaction.guildId})` : 'DM',
    channel: interaction.channelId,
    delay: `${receivedDelay}ms`
  });

  if (receivedDelay > 1500) {
    log.warn('CMD', 'Interaction received late, risk of "Unknown interaction" (3s limit)', {
      delay: `${receivedDelay}ms`
    });
  }

  try {
    await runInteraction(interaction, store);
  } catch (error) {
    store.outcome = 'error';
    log.error('CMD', `Unhandled error while running ${label}`, { error: error.message }, error);

    try {
      const content = '❌ Something went wrong, try again later.';
      if (interaction.deferred || interaction.replied) await interaction.editReply({ content });
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    } catch (replyError) {
      log.warn('CMD', 'Could not send the error message to the user', { error: replyError.message });
    }
  } finally {
    const duration = `${Math.round(performance.now() - store.start)}ms`;
    const level = store.outcome === 'error' ? 'error'
      : store.outcome === 'rate_limited' ? 'warn'
      : 'info';
    log[level]('CMD', `Finished ${label} -> ${store.outcome.toUpperCase()}`, { duration });
  }
}

async function runInteraction(interaction, store) {
  const isScoreboardPaging = interaction.isButton() && interaction.customId.startsWith('sb:');
  const waitMs = isScoreboardPaging ? 0 : checkRateLimit(interaction.user.id);
  if (waitMs > 0) {
    const seconds = Math.ceil(waitMs / 1000);
    store.outcome = 'rate_limited';
    log.warn('RATELIMIT', 'User rate limited', {
      user: `${interaction.user.tag}(${interaction.user.id})`,
      retryIn: `${seconds}s`
    });
    return interaction.reply({
      content: `⏳ Rate limit reached! Try again in **${seconds}s**.`,
      flags: MessageFlags.Ephemeral
    });
  }

  if (interaction.isButton()) {
    if (interaction.customId.startsWith('sb:')) {
      const [, type, pageStr] = interaction.customId.split(':');
      if (type !== 'players' && type !== 'clans') {
        store.outcome = 'ignored';
        log.warn('CMD', 'Scoreboard button with invalid type ignored', { customId: interaction.customId });
        return;
      }

      try {
        const data = await fetchScoreboard();
        log.info('CMD', 'Scoreboard page requested', { type, page: Number(pageStr) + 1 });
        return interaction.update(buildScoreboardView(data, type, Number(pageStr) || 0));
      } catch (error) {
        store.outcome = 'error';
        log.error('CMD', 'Scoreboard paging failed', { type, page: pageStr, error: error.message }, error);
        return interaction.reply({
          content: '❌ Could not fetch the scoreboard, try again later.',
          flags: MessageFlags.Ephemeral
        });
      }
    }

    if (!interaction.customId.startsWith('clan:')) {
      store.outcome = 'ignored';
      log.warn('CMD', 'Button with unknown customId ignored', { customId: interaction.customId });
      return;
    }

    const tag = interaction.customId.slice('clan:'.length);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return replyWithClan(interaction, tag);
  }

  if (interaction.commandName === 'ping') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const commandLatency = Date.now() - interaction.createdTimestamp;
    const wsPing = Math.round(client.ws.ping);
    const api = await pingBlockFrontApi();

    const apiStatus = api.ok ? '🟢 Online' : '🔴 Offline';

    log.info('CMD', 'Ping results', {
      commandLatency: `${commandLatency}ms`,
      ws: wsPing >= 0 ? `${wsPing}ms` : 'N/A',
      uptime: formatUptime(client.uptime),
      apiOk: api.ok,
      apiStatus: api.status,
      apiLatency: `${api.latency}ms`
    });
    if (!api.ok) store.outcome = 'api_down';

    const pingEmbed = new EmbedBuilder()
      .setColor(api.ok ? 0xB8BF6B : 0xC9584E)
      .setTitle('🏓 Pong !')
      .addFields(
        {
          name: '🤖 Bot',
          value:
            `Command latency: **${commandLatency}ms** ${latencyIcon(commandLatency)}\n` +
            `WebSocket: **${wsPing >= 0 ? `${wsPing}ms` : 'N/A'}** ${latencyIcon(wsPing)}\n` +
            `Uptime: **${formatUptime(client.uptime)}**`,
          inline: false
        },
        {
          name: '🌐 BlockFront API',
          value:
            `Status: **${apiStatus}**\n` +
            `Response time: **${api.latency}ms** ${latencyIcon(api.latency)}\n` +
            `HTTP: **${api.status}**\n`,
          inline: false
        }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [pingEmbed] });
    return;
  }

  if (interaction.commandName === 'stats') {
    const name = interaction.options.getString('name', true);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const player = await fetchPlayer(name);

      if (!player || !player.stats) {
        store.outcome = 'not_found';
        log.info('CMD', 'Player not found', { name, apiReturned: player ? 'no stats' : '404' });
        return interaction.editReply({ content: `❌ Player **${name}** not found.` });
      }

      const s = player.stats;
      const c = player.class_exp;
      const games = Number(s.games) || 0;
      const winRate = games > 0 ? Number(s.wins) / games : 0;

      if (!c) {
        log.warn('CMD', 'Player has no class_exp data', { name: player.username });
      }

      const statsEmbed = new EmbedBuilder()
        .setColor(0x70A641)
        .setTitle(`BlockFront stats of ${escapeMarkdown(player.username)}`)
        .setThumbnail(`https://mc-heads.net/avatar/${player.uuid}/128`)
        .setDescription(
          `**Rank:** ${player.rank?.title ?? 'N/A'} ${rankEmoji(player.rank)}\n` +
          `**Prestige:** ${fmt(s.prestige)}\n` +
          `**Clan:** ${player.clan ? `[${player.clan.tag}] ${player.clan.name}` : 'None'}\n` +
          `**Skill rank:** ${s.skill_rank ?? 'N/A'} ${skillEmoji(s.skill_rank)}`
        )
        .addFields(
          {
            name: '🏆 Progression',
            value:
              `EXP: **${fmt(s.exp)}**\n` +
              `Karma: **${fmt(s.karma)}**\n` +
              `Games: **${fmt(s.games)}**\n` +
              `Wins: **${fmt(s.wins)}** (${pct(winRate)})`,
            inline: false
          },
          {
            name: '⚔️ Combat',
            value:
              `Kills: **${fmt(s.kills)}**\n` +
              `Deaths: **${fmt(s.deaths)}**\n` +
              `K/D: **${fmt(s.kd, 2)}**\n` +
              `Assists: **${fmt(s.assists)}**\n` +
              `Best streak: **${fmt(s.kills_streak)}**\n` +
              `Headshots: **${fmt(s.headshots)}**\n` +
              `HS ratio: **${pct(s.headshots_ratio)}**\n` +
              `Noscopes: **${fmt(s.noscopes)}**\n` +
              `Backstabs: **${fmt(s.backstabs)}**\n` +
              `First bloods: **${fmt(s.first_bloods)}**\n` +
              `Bots: **${fmt(s.kills_bots)}**\n` +
              `Vehicles: **${fmt(s.kills_vehicles)}**\n` +
              `Fire: **${fmt(s.kills_fire)}**`,
            inline: false
          },
          {
            name: '🎯 Objectives',
            value:
              `Captures: **${fmt(s.captures)}**\n` +
              `Objective score: **${fmt(s.objective_score)}**`,
            inline: false
          },
          {
            name: '🧟 Infected',
            value:
              `Infected: **${fmt(s.kills_infected)}**\n` +
              `Rounds won: **${fmt(s.infected_rounds_won)}**\n` +
              `Matches won: **${fmt(s.infected_matches_won)}**`,
            inline: false
          },
          {
            name: '🕹️ Others',
            value: 
              `Playtime: **${formatTime(s.time)}**\n` + 
              `Completed Bootcamp: **${formatBootcamp(s.bootcamp)}**`,
            inline: false
          },
          {
            name: "🎖️ Class EXP",
            value:
              `${classEmoji(0)} Rifleman: **${fmt(c[0])}**\n` + 
              `${classEmoji(1)} Lt. Rifle: **${fmt(c[1])}**\n` + 
              `${classEmoji(2)} Assault: **${fmt(c[2])}**\n` + 
              `${classEmoji(3)} Support: **${fmt(c[3])}**\n` + 
              `${classEmoji(4)} Medic: **${fmt(c[4])}**\n` + 
              `${classEmoji(5)} Sniper: **${fmt(c[5])}**\n` + 
              `${classEmoji(6)} Gunner: **${fmt(c[6])}**\n` + 
              `${classEmoji(7)} Anti-Tank: **${fmt(c[7])}**\n` + 
              `${classEmoji(8)} Specialist: **${fmt(c[8])}**\n` + 
              `${classEmoji(9)} Commander: **${fmt(c[9])}**`,
            inline: false
          }
        )
        .setFooter({ text: `UUID: ${player.uuid}` })
        .setTimestamp();

      const components = [];
      if (player.clan?.tag) {
        components.push(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`clan:${player.clan.tag}`)
              .setLabel('View clan')
              .setEmoji('🛡️')
              .setStyle(ButtonStyle.Secondary)
          )
        );
      }

      await interaction.editReply({ embeds: [statsEmbed], components });
      log.info('CMD', 'Stats sent', {
        player: player.username,
        uuid: player.uuid,
        rank: player.rank?.title,
        clan: player.clan?.tag ?? 'none'
      });
    } catch (error) {
      store.outcome = 'error';
      log.error('CMD', 'Failed to fetch/send stats', { name, error: error.message }, error);
      await interaction.editReply({ content: '❌ Could not fetch stats, try again later.' });
    }
    return;
  }

  if (interaction.commandName === 'clan') {
    const tag = interaction.options.getString('tag', true).trim();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return replyWithClan(interaction, tag);
  }

  if (interaction.commandName === 'scoreboard') {
    const type = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const data = await fetchScoreboard();
      await interaction.editReply(buildScoreboardView(data, type, 0));
    } catch (error) {
      store.outcome = 'error';
      log.error('CMD', 'Failed to fetch/send scoreboard', { type, error: error.message }, error);
      await interaction.editReply({ content: '❌ Could not fetch the scoreboard, try again later.' });
    }
    return;
  }

  if (interaction.commandName === 'rules') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const rules = await fetchRules();
      await interaction.editReply({ embeds: [buildRulesEmbed(rules)] });
      log.info('CMD', 'Rules sent', { rules: Object.keys(rules ?? {}).length });
    } catch (error) {
      store.outcome = 'error';
      log.error('CMD', 'Failed to fetch/send rules', { error: error.message }, error);
      await interaction.editReply({ content: '❌ Could not fetch the rules, try again later.' });
    }
    return;
  }

  store.outcome = 'unknown_command';
  log.warn('CMD', 'Unknown command (registered on Discord but not handled in code)', {
    command: interaction.commandName
  });
}

(async () => {
  let apiHost = 'invalid URL';
  try { apiHost = new URL(API_URL).host; } catch {}

  log.info('BOOT', 'Starting BotFront', {
    node: process.version,
    discordjs: DISCORD_JS_VERSION,
    pid: process.pid,
    platform: `${process.platform}/${process.arch}`,
    logLevel: Object.keys(LEVELS).find(k => LEVELS[k] === MIN_LEVEL)
  });
  log.info('BOOT', 'Environment OK', { apiHost, clientId: CLIENT_ID, tokenLoaded: true, apiKeyLoaded: true });

  await registerCommands();

  log.info('BOOT', 'Connecting to Discord gateway...');
  try {
    await client.login(TOKEN);
  } catch (error) {
    log.error('BOOT', 'Discord login FAILED', { code: error.code, error: error.message }, error);
    process.exit(1);
  }
})();