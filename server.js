require('dotenv').config();
const express  = require('express');
const session  = require('express-session');
const fetch    = require('node-fetch');
const { Client, GatewayIntentBits } = require('discord.js');
const cors     = require('cors');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Discord bot (role assignment) ──────────────────────────────────
const bot = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
bot.login(process.env.DISCORD_BOT_TOKEN);
bot.once('ready', () => console.log(`🤖 Bot: ${bot.user.tag}`));

// ── Middleware ─────────────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'baconSecret99',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 1000 * 60 * 30,
  },
}));

// ── Roblox helpers ─────────────────────────────────────────────────
const RBX = {
  user:      (id) => `https://users.roblox.com/v1/users/${id}`,
  badges:    (id) => `https://badges.roblox.com/v1/users/${id}/badges?limit=25&sortOrder=Desc`,
  groups:    (id) => `https://groups.roblox.com/v1/users/${id}/groups/roles`,
  inventory: (id) => `https://inventory.roblox.com/v2/users/${id}/inventory?assetTypes=8,17,18,19&limit=25`,
  rbxBadges: (id) => `https://accountinformation.roblox.com/v1/users/${id}/roblox-badges`,
  avatar:    (id) => `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${id}&size=150x150&format=Png`,
};

async function rbxFetch(url) {
  const r = await fetch(url, { timeout: 10000 });
  if (!r.ok) throw new Error(`Roblox ${r.status}`);
  return r.json();
}

// ── Routes ─────────────────────────────────────────────────────────

app.get('/', (_, res) => res.json({ status: '🥓 BaconVerify backend online' }));

// 1. Redirect → Discord OAuth
app.get('/auth/discord', (_, res) => {
  const url = new URL('https://discord.com/api/oauth2/authorize');
  url.searchParams.set('client_id',    process.env.DISCORD_CLIENT_ID);
  url.searchParams.set('redirect_uri', process.env.DISCORD_REDIRECT_URI);
  url.searchParams.set('response_type','code');
  url.searchParams.set('scope',        'identify guilds.join');
  res.redirect(url.toString());
});

// 2. Discord callback
app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect(`${process.env.FRONTEND_URL}?error=no_code`);

  try {
    // Exchange code for token
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type:    'authorization_code',
        code,
        redirect_uri:  process.env.DISCORD_REDIRECT_URI,
      }),
    });
    const token = await tokenRes.json();
    if (token.error) throw new Error(token.error_description);

    // Get Discord user info
    const userRes  = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    const dUser = await userRes.json();

    // Account age check (7 day minimum)
    const snowflake = BigInt(dUser.id);
    const createdAt = new Date(Number((snowflake >> 22n) + 1420070400000n));
    const ageDays   = Math.floor((Date.now() - createdAt.getTime()) / 86400000);

    if (ageDays < 7) {
      return res.redirect(`${process.env.FRONTEND_URL}?error=account_too_new&age=${ageDays}`);
    }

    req.session.discord = {
      id:          dUser.id,
      username:    dUser.username,
      discriminator: dUser.discriminator,
      avatar:      dUser.avatar,
      createdAt:   createdAt.toISOString(),
      ageDays,
      accessToken: token.access_token,
    };

    res.redirect(`${process.env.FRONTEND_URL}?discord=ok`);
  } catch (e) {
    console.error('OAuth error:', e.message);
    res.redirect(`${process.env.FRONTEND_URL}?error=oauth_failed`);
  }
});

// 3. Session info
app.get('/auth/me', (req, res) => {
  if (!req.session.discord) return res.json({ discord: null });
  const { id, username, discriminator, avatar, createdAt, ageDays } = req.session.discord;
  res.json({
    discord: {
      id, username, discriminator, ageDays, createdAt,
      avatarUrl: avatar
        ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.png`
        : `https://cdn.discordapp.com/embed/avatars/0.png`,
    },
  });
});

// 4. Roblox scan + role assign
app.post('/verify/roblox', async (req, res) => {
  if (!req.session.discord) return res.status(401).json({ error: 'Not logged in with Discord.' });

  const { robloxId } = req.body;
  if (!robloxId || !/^\d+$/.test(robloxId)) return res.status(400).json({ error: 'Invalid Roblox ID.' });

  try {
    const [userR, badgesR, groupsR, inventoryR, rbxBadgesR, avatarR] = await Promise.allSettled([
      rbxFetch(RBX.user(robloxId)),
      rbxFetch(RBX.badges(robloxId)),
      rbxFetch(RBX.groups(robloxId)),
      rbxFetch(RBX.inventory(robloxId)),
      rbxFetch(RBX.rbxBadges(robloxId)),
      rbxFetch(RBX.avatar(robloxId)),
    ]);

    if (userR.status === 'rejected' || userR.value?.errors) {
      return res.status(404).json({ error: 'Roblox user not found.' });
    }

    const data = {
      user:      userR.value,
      badges:    badgesR.value?.data    || [],
      groups:    groupsR.value?.data    || [],
      inventory: inventoryR.value?.data || [],
      rbxBadges: Array.isArray(rbxBadgesR.value) ? rbxBadgesR.value : [],
      avatarUrl: avatarR.value?.data?.[0]?.imageUrl || null,
    };

    // Assign role via bot
    let roleAssigned = false;
    try {
      const guild  = await bot.guilds.fetch(process.env.GUILD_ID);
      const member = await guild.members.fetch(req.session.discord.id);
      await member.roles.add(process.env.VERIFIED_ROLE_ID);
      roleAssigned = true;
    } catch (e) { console.warn('Role assign:', e.message); }

    // Auto-join guild if not already in it
    try {
      await fetch(`https://discord.com/api/guilds/${process.env.GUILD_ID}/members/${req.session.discord.id}`, {
        method: 'PUT',
        headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: req.session.discord.accessToken }),
      });
    } catch (e) { console.warn('Guild join:', e.message); }

    req.session.verified = true;
    res.json({ success: true, roleAssigned, data });

  } catch (e) {
    console.error('Verify error:', e.message);
    res.status(500).json({ error: e.message || 'Verification failed.' });
  }
});

// Logout
app.post('/auth/logout', (req, res) => { req.session.destroy(); res.json({ ok: true }); });

app.listen(PORT, () => console.log(`🥓 BaconVerify backend on port ${PORT}`));

