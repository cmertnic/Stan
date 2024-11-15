const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ChannelType, PermissionsBitField } = require('discord.js');
const { saveServerSettings, getServerSettings } = require('../../database/settingsDb');
const validLanguages = ['ben', 'chi', 'eng', 'fra', 'ger', 'hin', 'jpn', 'kor', 'por', 'rus', 'spa'];
const { i18next, t, updateI18nextLanguage } = require('../../i18n');
const userCommandCooldowns = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('language')
    .setDescription('server language '),

  async execute(robot, interaction) {
    if (interaction.user.bot) return;
    if (interaction.channel.type === ChannelType.DM) {
      return await interaction.reply({ content: i18next.t('error_private_messages'), ephemeral: true });
    }

    const commandCooldown = userCommandCooldowns.get(interaction.user.id);
    if (commandCooldown && commandCooldown.command === 'language' && Date.now() < commandCooldown.endsAt) {
      const timeLeft = Math.round((commandCooldown.endsAt - Date.now()) / 1000);
      return await interaction.reply({ content: (i18next.t(`cooldown`, { timeLeft: timeLeft})), ephemeral: true });
    }

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return await interaction.reply({ content: i18next.t('Admin_user_check'), ephemeral: true });
    }

    const config = await getServerSettings(interaction.guildId) || { language: 'eng' };

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('language_select')
      .setPlaceholder(i18next.t('language-js_select_language'));

    validLanguages.forEach((lang) => {
      const option = new StringSelectMenuOptionBuilder()
        .setLabel(i18next.t(`language-js_language_${lang}`))
        .setValue(lang);

      if (lang === config.language) {
        option.setDefault(true);
      }

      selectMenu.addOptions(option);
    });

    const selectMenuRow = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.reply({
      components: [selectMenuRow],
      ephemeral: true,
    });

    const collector = interaction.channel.createMessageComponentCollector({
      filter: (i) => i.user.id === interaction.user.id,
      time: 30000,
    });

    userCommandCooldowns.set(interaction.user.id, { command: 'language', endsAt: Date.now() + 300200 });

    collector.on('collect', async (i) => {
      if (i.customId === 'language_select') {
        const newLanguage = i.values?.[0] || 'eng';
        config.language = newLanguage;
        await saveServerSettings(interaction.guildId, config);
        updateI18nextLanguage(interaction.guildId, newLanguage);

        await i.update({
          content: i18next.t('language-js_language_updated', { newLanguage }),
          components: [],
        });
      }
    });

    collector.on('end', () => {
      userCommandCooldowns.delete(interaction.user.id);
    });
  },
};
