// Импортируем необходимые модули из discord.js и нашей базы данных/i18n
const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ChannelType, PermissionsBitField } = require('discord.js');
const { saveServerSettings, getServerSettings } = require('../../database/settingsDb');
const validLanguages = ['ben', 'chi', 'eng', 'fra', 'ger', 'hin', 'jpn', 'kor', 'por', 'rus', 'spa'];
const { i18next, t, updateI18nextLanguage } = require('../../i18n');


module.exports = {
  data: new SlashCommandBuilder()
    .setName('language') 
    .setDescription(i18next.t('language-js_description')),


  async execute(robot, interaction) {
    if (interaction.user.bot) return; // Если пользователь бот, прерываем исполнение команды

    if (interaction.channel.type === ChannelType.DM) {
      interaction.reply({ content: i18next.t('error_private_messages'), ephemeral: true });
      return; // Если сообщение отправлено в личные сообщения, отвечаем ошибкой и прерываем исполнение
    }

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      interaction.reply({ content: i18next.t('Admin_user_check'), ephemeral: true });
      return; // Если пользователь не админ, отвечаем ошибкой и прерываем исполнение
    }

    const config = await getServerSettings(interaction.guildId) || { language: 'eng' }; // Получаем текущие настройки сервера

    const selectMenu = new StringSelectMenuBuilder() // Создаем меню выбора языка
      .setCustomId('language_select')
      .setPlaceholder(i18next.t('language-js_select_language'));

    validLanguages.forEach((lang) => { // Добавляем опции в меню для каждого доступного языка
      const option = new StringSelectMenuOptionBuilder()
        .setLabel(i18next.t(`language-js_language_${lang}`))
        .setValue(lang);

      if (lang === config.language) {
        option.setDefault(true);
      }

      selectMenu.addOptions(option);
    });

    const selectMenuRow = new ActionRowBuilder().addComponents(selectMenu); // Добавляем меню в строку

    await interaction.reply({ // Отправляем сообщение с меню выбора языка
      components: [selectMenuRow],
      ephemeral: true,
    });

    const collector = interaction.channel.createMessageComponentCollector({ // Создаем коллектор для сбора ответов на меню
      filter: (i) => i.user.id === interaction.user.id,
      time: 15000,
    });

    collector.on('collect', async (i) => { // Обрабатываем собранные ответы
      if (i.user.id !== interaction.user.id) return;
      if (i.deferred || i.replied) return;

      if (i.customId === 'language_select') { // Если пользователь выбрал язык
        const newLanguage = i.values?.[0] || 'eng'; // Получаем выбранный язык
        config.language = newLanguage; // Обновляем настройки сервера
        await saveServerSettings(interaction.guildId, config);
        updateI18nextLanguage(interaction.guildId, newLanguage); // Обновляем язык в i18next

        i18next.changeLanguage(newLanguage); // Меняем язык у i18next

        await interaction.editReply({ // Редактируем сообщение с меню, уведомляя о выбранном языке
          content: i18next.t('language-js_language_updated', { newLanguage }),
          components: [],
        });
      }
    });
  },
};