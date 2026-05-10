const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const fetch = require('node-fetch');

// ── config — edit these ────────────────────────────────────────────
const CONFIG = {
  VERIFIED_ROLE_ID: process.env.VERIFIED_ROLE_ID || 'YOUR_ROLE_ID_HERE',
  // Optional: minimum badges required, set 0 to disable
  MIN_BADGES: 0,
  // Optional: require user to be in a specific Roblox group ID, set null to disable
  REQUIRED_GROUP_ID: null,
};

// ── Roblox API (direct — no proxy needed server-side!) ─────────────
const API = {
  user:     (id) => `https://users.roblox.com/v1/users/${id}`,
  badges:   (id) => `https://badges.roblox.com/v1/users/${id}/badges?limit=25&sortOrder=Desc`,
  groups:   (id) => `https://groups.roblox.com/v1/users/${id}/groups/roles`,
  inventory:(id) => `https://inventory.roblox.com/v2/users/${id}/inventory?assetTypes=8,17,18,19&limit=25`,
  rbxBadges:(id) => `https://accountinformation.roblox.com/v1/users/${id}/roblox-badges`,
  avatar:   (id) => `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${id}&size=150x150&format=Png&isCircular=false`,
};

async function rbxFetch(url) {
  const res = await fetch(url, { timeout: 10000 });
  if (!res.ok) throw new Error(`Roblox API ${res.status}`);
  return res.json();
}

async function scanUser(userId) {
  const [user, badges, groups, inventory, rbxBadges, avatarRes] = await Promise.allSettled([
    rbxFetch(API.user(userId)),
    rbxFetch(API.badges(userId)),
    rbxFetch(API.groups(userId)),
    rbxFetch(API.inventory(userId)),
    rbxFetch(API.rbxBadges(userId)),
    rbxFetch(API.avatar(userId)),
  ]);

  if (user.status === 'rejected' || user.value?.errors) {
    throw new Error('User not found. Double-check the ID.');
  }

  return {
    user:       user.value,
    badges:     badges.value?.data     || [],
    groups:     groups.value?.data     || [],
    inventory:  inventory.value?.data  || [],
    rbxBadges:  Array.isArray(rbxBadges.value) ? rbxBadges.value : [],
    avatarUrl:  avatarRes.value?.data?.[0]?.imageUrl || null,
  };
}

// ── embeds ─────────────────────────────────────────────────────────
function buildVerifyEmbed() {
  return new EmbedBuilder()
    .setColor(0xe8344a)
    .setTitle('🥓  BaconVerify')
    .setDescription(
      '### Verify your Roblox account\n' +
      'Click the button below, enter your **Roblox User ID**, and we\'ll scan your account instantly.\n\n' +
      '> 💡 Find your ID at `roblox.com/users/YOUR_ID/profile`'
    )
    .addFields(
      { name: '🏅 What we scan', value: 'Badges · Groups · Inventory · Official Badges', inline: false },
      { name: '🔒 Privacy', value: 'Read-only public data. No login required.', inline: false },
    )
    .setFooter({ text: 'BaconVerify • Powered by the Roblox API' })
    .setTimestamp();
}

function buildResultEmbed(data) {
  const { user, badges, groups, inventory, rbxBadges, avatarUrl } = data;

  const groupList = groups.slice(0, 5)
    .map(g => `• **${g.group.name}** (${g.role?.name || 'Member'})`)
    .join('\n') || '*No public groups*';

  const badgeList = badges.slice(0, 5)
    .map(b => `• ${b.name}`)
    .join('\n') || '*No badges found*';

  const officialBadges = rbxBadges.length
    ? rbxBadges.map(b => `⭐ ${b.name}`).join(' · ')
    : '*None*';

  const embed = new EmbedBuilder()
    .setColor(0x22d68c)
    .setTitle('✅  Verification Successful')
    .setDescription(`**${user.displayName}** (@${user.name}) has been verified!`)
    .addFields(
      { name: `🏅 Badges (${badges.length})`,     value: badgeList,      inline: true  },
      { name: `👥 Groups (${groups.length})`,      value: groupList,      inline: true  },
      { name: `🎒 Inventory (${inventory.length})`,value: `${inventory.length} public item(s)`, inline: true },
      { name: '⭐ Official Roblox Badges',          value: officialBadges, inline: false },
    )
    .setFooter({ text: `User ID: ${user.id} • BaconVerify` })
    .setTimestamp();

  if (avatarUrl) embed.setThumbnail(avatarUrl);

  return embed;
}

function buildFailEmbed(reason) {
  return new EmbedBuilder()
    .setColor(0xe8344a)
    .setTitle('❌  Verification Failed')
    .setDescription(reason)
    .setFooter({ text: 'BaconVerify' });
}

// ── button row ─────────────────────────────────────────────────────
function buildVerifyButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('bacon_verify')
      .setLabel('🥓  Verify My Account')
      .setStyle(ButtonStyle.Danger)
  );
}

// ── post embed to channel ──────────────────────────────────────────
async function postVerifyEmbed(channel) {
  await channel.send({
    embeds: [buildVerifyEmbed()],
    components: [buildVerifyButton()],
  });
}

// ── modal ──────────────────────────────────────────────────────────
function buildModal() {
  const modal = new ModalBuilder()
    .setCustomId('bacon_modal')
    .setTitle('🥓 BaconVerify — Enter your Roblox ID');

  const input = new TextInputBuilder()
    .setCustomId('roblox_id')
    .setLabel('Roblox User ID (numbers only)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g.  1   or   156   or   261')
    .setMinLength(1)
    .setMaxLength(20)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

// ── interaction handler ────────────────────────────────────────────
async function handleInteraction(interaction) {
  // ── button clicked → show modal ──
  if (interaction.isButton() && interaction.customId === 'bacon_verify') {
    await interaction.showModal(buildModal());
    return;
  }

  // ── modal submitted → scan ──
  if (interaction.isModalSubmit() && interaction.customId === 'bacon_modal') {
    const rawId = interaction.fields.getTextInputValue('roblox_id').trim();

    if (!/^\d+$/.test(rawId)) {
      await interaction.reply({
        embeds: [buildFailEmbed('❌ Invalid User ID — numbers only please.')],
        ephemeral: true,
      });
      return;
    }

    // defer so we have time to fetch
    await interaction.deferReply({ ephemeral: true });

    try {
      const data = await scanUser(rawId);

      // ── optional checks ──
      if (CONFIG.MIN_BADGES > 0 && data.badges.length < CONFIG.MIN_BADGES) {
        await interaction.editReply({
          embeds: [buildFailEmbed(`❌ You need at least **${CONFIG.MIN_BADGES}** badges to verify.`)],
        });
        return;
      }

      if (CONFIG.REQUIRED_GROUP_ID) {
        const inGroup = data.groups.some(g => g.group.id === CONFIG.REQUIRED_GROUP_ID);
        if (!inGroup) {
          await interaction.editReply({
            embeds: [buildFailEmbed(`❌ You must be in the required Roblox group to verify.`)],
          });
          return;
        }
      }

      // ── assign verified role ──
      try {
        const member = interaction.member;
        const role = interaction.guild.roles.cache.get(CONFIG.VERIFIED_ROLE_ID);
        if (role) await member.roles.add(role);
      } catch (e) {
        console.warn('Could not assign role:', e.message);
      }

      // ── send result ──
      await interaction.editReply({
        embeds: [buildResultEmbed(data)],
      });

    } catch (e) {
      await interaction.editReply({
        embeds: [buildFailEmbed(`❌ ${e.message || 'Something went wrong. Try again.'}`)],
      });
    }
  }
}

module.exports = { postVerifyEmbed, handleInteraction };

