const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField } = require('discord.js');
const { saveServerSettings, getServerSettings } = require('../../database/settingsDb');
const validLanguages = ['ben', 'chi', 'eng', 'fra', 'ger', 'hin', 'jpn', 'kor', 'por', 'rus', 'spa'];
const { i18next, t, updateI18nextLanguage } = require('../../i18n');

async function displayLanguageButtons(interaction, config, isUpdate = false, newLanguage = config.language) {
  if (interaction.deferred || (interaction.replied && !isUpdate)) return;

  const languageEmbed = new EmbedBuilder()
    .setColor('White')
    .setTitle(t('language-js_title', { currentLanguage: config.language }))
    .setDescription(t('language-js_description', { currentLanguage: newLanguage }));

  const rows = validLanguages.reduce((acc, lang) => {
    const button = createButton(lang, t(`language-js_language_${lang}`), lang === newLanguage);
    const row = new ActionRowBuilder().addComponents(button);

    if (acc.length === 0 || (acc[acc.length - 1] && acc[acc.length - 1].components.length < 4)) {
      if (acc[acc.length - 1]) {
        acc[acc.length - 1].addComponents(button);
      } else {
        acc.push(row);
      }
    } else {
      acc.push(row);
    }

    return acc;
  }, []);

  if (!isUpdate) {
    await interaction.reply({ embeds: [languageEmbed], components: rows, ephemeral: true });
  } else {
    await new Promise(resolve => setTimeout(resolve, 500));
    await interaction.editReply({ embeds: [languageEmbed], components: rows });
  }

  return rows;
}

function createButton(customId, label, selected) {
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(selected ? ButtonStyle.Success : ButtonStyle.Secondary);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('language')
    .setDescription(t('language-js_description')),
  async execute(robot, interaction) {
    if (interaction.user.bot) return;
    if (interaction.channel.type === ChannelType.DM) {
      interaction.reply({ content: t('error_private_messages'), ephemeral: true });
      return;
    }

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      interaction.reply({ content: t('Admin_user_check'), ephemeral: true });
      return;
    }

    try {
      const config = await getServerSettings(interaction.guildId) || { language: 'eng' };

      const rows = await displayLanguageButtons(interaction, config);

      const collector = interaction.channel.createMessageComponentCollector({
        filter: (i) => i.user.id === interaction.user.id,
        time: 15000
      });

      collector.on('collect', async (i) => {
        if (i.user.id !== interaction.user.id) return;
        if (i.deferred || i.replied) return;

        const newLanguage = validLanguages.find(lang => lang === i.customId);
        if (!newLanguage) return;

        config.language = newLanguage;
        await saveServerSettings(interaction.guildId, config);
        updateI18nextLanguage(interaction.guildId, newLanguage);

        const updatedRows = await displayLanguageButtons(interaction, config, true, newLanguage);

        const languageEmbed = new EmbedBuilder()
          .setColor('White')
          .setTitle(t('language-js_title', { currentLanguage: config.language }))
          .setDescription(t('language-js_description', { currentLanguage: newLanguage }));

          await interaction.editReply({ content: t('language-js_description', { currentLanguage: newLanguage }), embeds: [languageEmbed], components: updatedRows });
      });
    } catch (err) {
      console.error('Error executing language command:', err);
      if (!interaction.deferred && !interaction.replied) {
        await interaction.reply({ content: t('Error'), ephemeral: true });
      }
    }
  },
};