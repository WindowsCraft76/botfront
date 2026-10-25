require('dotenv').config({ quiet: true });
const {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder,
  MessageFlags, ActivityType, ActionRowBuilder, ButtonBuilder, ButtonStyle, escapeMarkdown
} = require('discord.js');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const API_KEY = process.env.BLOCKFRONT_API_KEY;
const API_URL = process.env.BLOCKFRONT_API_URL

if (!TOKEN || !CLIENT_ID || !API_URL || !API_KEY) {
  throw new Error('TOKEN, CLIENT_ID, BLOCKFRONT_API_URL and BLOCKFRONT_API_KEY must be defined !');
}

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
    )
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log('Registering slash commands...');
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );
    console.log('Orders successfully recorded!');
  } catch (error) {
    console.error(error);
  }
})();

let customEmojis = new Map();

async function loadRankEmojis() {
  const emojis = await client.application.emojis.fetch();
  customEmojis = new Map(emojis.map(e => [e.name, e.toString()]));
  console.log(`${customEmojis.size} application emojis loaded.`);
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
  console.log(`Logged in as ${client.user.tag} !`);
  try {
    await loadRankEmojis();
  } catch (error) {
    console.error('Could not load emojis:', error);
  }

  updatePresence();
  setInterval(updatePresence, 60_000);
});

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

async function fetchPlayer(name) {
  const url = API_URL + `?type=player&name=${encodeURIComponent(name)}`;
  const res = await fetch(url, { headers: { 'X-API-Key': API_KEY } });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API error ${res.status}`);

  return res.json();
}

async function fetchClan(tag) {
  const url = API_URL + `?type=clan&tag=${encodeURIComponent(tag)}`;
  const res = await fetch(url, { headers: { 'X-API-Key': API_KEY } });

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
      return interaction.editReply({ content: `❌ Clan **${escapeMarkdown(tag)}** not found.` });
    }

    await interaction.editReply({ embeds: [buildClanEmbed(clan)] });
  } catch (error) {
    console.error(error);
    await interaction.editReply({ content: '❌ Could not fetch clan info, try again later.' });
  }
}

async function fetchPlayerCount() {
  const res = await fetch(API_URL + '?type=player_count', {
    headers: { 'X-API-Key': API_KEY }
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const data = await res.json();
  return Number(data.playersOnline ?? 0);
}

async function updatePresence() {
  try {
    const count = await fetchPlayerCount();
    client.user.setPresence({
      activities: [{ name: `${fmt(count)} players online`, type: ActivityType.Watching }],
      status: 'online'
    });
  } catch (error) {
    console.error('Could not update presence:', error.message);
  }
}

async function pingBlockFrontApi() {
  const start = performance.now();
  try {
    const res = await fetch(API_URL + '?type=player_count', {
      headers: { 'X-API-Key': API_KEY },
      signal: AbortSignal.timeout(5000)
    });
    const latency = Math.round(performance.now() - start);

    if (!res.ok) {
      return { ok: false, latency, status: res.status, players: null };
    }

    const data = await res.json();
    return {
      ok: true,
      latency,
      status: res.status,
      players: Number(data.playersOnline ?? 0)
    };
  } catch (error) {
    return {
      ok: false,
      latency: Math.round(performance.now() - start),
      status: error.name === 'TimeoutError' ? 'Timeout' : 'Unreachable',
      players: null
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

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand() && !interaction.isButton()) return;

  const waitMs = checkRateLimit(interaction.user.id);
  if (waitMs > 0) {
    const seconds = Math.ceil(waitMs / 1000);
    return interaction.reply({
      content: `⏳ Rate limit reached! Try again in **${seconds}s**.`,
      flags: MessageFlags.Ephemeral
    });
  }

  if (interaction.isButton()) {
    if (!interaction.customId.startsWith('clan:')) return;

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

    const pingEmbed = new EmbedBuilder()
      .setColor(api.ok ? 0x57F287 : 0xDD2E44)
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
            `HTTP: **${api.status}**\n` +
            `Players online: **${api.players !== null ? fmt(api.players) : 'N/A'}**`,
          inline: false
        }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [pingEmbed] });
  }

    if (interaction.commandName === 'stats') {
    const name = interaction.options.getString('name', true);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const player = await fetchPlayer(name);

      if (!player || !player.stats) {
        return interaction.editReply({ content: `❌ Player **${name}** not found.` });
      }

      const s = player.stats;
      const c = player.class_exp;
      const games = Number(s.games) || 0;
      const winRate = games > 0 ? Number(s.wins) / games : 0;

      const statsEmbed = new EmbedBuilder()
        .setColor(0x7C8148)
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
            name: '🏆 Progression',
            value:
              `EXP: **${fmt(s.exp)}**\n` +
              `Karma: **${fmt(s.karma)}**\n` +
              `Games: **${fmt(s.games)}**\n` +
              `Wins: **${fmt(s.wins)}** (${pct(winRate)})`,
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
    } catch (error) {
      console.error(error);
      await interaction.editReply({ content: '❌ Could not fetch stats, try again later.' });
    }
  }

  if (interaction.commandName === 'clan') {
    const tag = interaction.options.getString('tag', true).trim();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return replyWithClan(interaction, tag);
  }
});

client.login(TOKEN);