require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { postVerifyEmbed } = require('./verify');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// ── ready ──────────────────────────────────────────────────────────
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ── slash commands ─────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  // /setup  →  posts the verify embed in current channel
  if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
    if (!interaction.member.permissions.has('Administrator')) {
      return interaction.reply({ content: '❌ Admins only.', ephemeral: true });
    }
    await postVerifyEmbed(interaction.channel);
    await interaction.reply({ content: '✅ Verify embed posted!', ephemeral: true });
    return;
  }

  // button / modal handled in verify.js
  const { handleInteraction } = require('./verify');
  await handleInteraction(interaction);
});

client.login(process.env.DISCORD_BOT_TOKEN);
