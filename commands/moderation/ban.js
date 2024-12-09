// Импортируем необходимые классы и модули
const { SlashCommandBuilder, ChannelType, EmbedBuilder } = require('discord.js');
const { createLogChannel, convertToMilliseconds, deleteMessages } = require('../../events');
const { getServerSettings } = require('../../database/settingsDb');
const { i18next, t } = require('../../i18n');

// Определяем названия опций с помощью i18next для локализации
const USER_OPTION_NAME = i18next.t('ban-js_user');
const DEL_MESS_TIME_OPTION_NAME = i18next.t('ban-js_del_mess_time');
const REASON_OPTION_NAME = i18next.t('ban-js_reason');

// Экспортируем команду как модуль
module.exports = {
  // Определяем данные команды с помощью SlashCommandBuilder
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription(i18next.t('ban-js_description'))
    .addUserOption(option => option.setName(USER_OPTION_NAME).setDescription(i18next.t('ban-js_user_description')).setRequired(true))
    .addStringOption(option => option.setName(DEL_MESS_TIME_OPTION_NAME).setDescription(i18next.t('ban-js_del_mess_time_description')).setRequired(true).addChoices(
      { name: i18next.t('ban-js_delete_mess_time_choise_0'), value: '0' },
      { name: i18next.t('ban-js_delete_mess_time_choise_1'), value: '1h' },
      { name: i18next.t('ban-js_delete_mess_time_choise_2'), value: '6h' },
      { name: i18next.t('ban-js_delete_mess_time_choise_3'), value: '12h' },
      { name: i18next.t('ban-js_delete_mess_time_choise_4'), value: '1d' },
      { name: i18next.t('ban-js_delete_mess_time_choise_5'), value: '3d' },
      { name: i18next.t('ban-js_delete_mess_time_choise_6'), value: '7d' }
    ))
    .addStringOption(option => option.setName(REASON_OPTION_NAME).setDescription(i18next.t('ban-js_reason_description')).setRequired(false)),

  async execute(robot, interaction) {
    if (interaction.user.bot) return;
    if (interaction.channel.type === ChannelType.DM) {
      return await interaction.reply({ content: i18next.t('error_private_messages'), ephemeral: true });
    }
    // Откладываем ответ, чтобы бот не блокировался во время выполнения команды
    await interaction.deferReply({ ephemeral: true });

    try {
      // Проверяем, является ли пользователь ботом или используется команда в личных сообщениях
      if (interaction.user.bot || interaction.channel.type === ChannelType.DM) {
        return interaction.editReply(i18next.t('error_private_messages'));
      }

      // Извлекаем объекты member и guild из interaction
      const { member, guild } = interaction;

      // Получаем пользователя, которого нужно забанить, и его ID
      const user = interaction.options.getMember(USER_OPTION_NAME);
      const userId = user.id;

      // Получаем причину бана (или причину по умолчанию)
      const reason = interaction.options.getString(REASON_OPTION_NAME) || i18next.t('defaultReason');

      // Получаем период времени для удаления сообщений от забаненного пользователя
      const deleteMessagesTime = interaction.options.getString(DEL_MESS_TIME_OPTION_NAME);

      // Получаем настройки сервера для текущей гильдии
      const serverSettings = await getServerSettings(guild.id);
      const logChannelName = serverSettings.logChannelName;
      const banLogChannelName = serverSettings.banLogChannelName;
      const banLogChannelNameUse = serverSettings.banLogChannelNameUse;
      const deletingMessagesFromBannedUsers = serverSettings.deletingMessagesFromBannedUsers;
      const moderator = interaction.user;
      const botMember = guild.members.cache.get(robot.user.id);
      // Проверяем, имеет ли пользователь право 'BanMembers' и имеет ли бот это же право
      if (!member.roles.cache.some(role => role.permissions.has('BanMembers'))) {
        return interaction.editReply({ content: i18next.t('BanMembers_user_check'), ephemeral: true });
      }
      if (!botMember.roles.cache.some(role => role.permissions.has('BanMembers'))) {
        return interaction.editReply({ content: i18next.t('BanMembers_bot_check'), ephemeral: true });
      }
      // Проверяем, имеет ли пользователь, которого собираются забанить, более высокую роль, чем у пользователя, который выполняет команду, или у бота
      if (user.roles.highest.comparePositionTo(interaction.member.roles.highest) > 0 || user.roles.highest.comparePositionTo(guild.members.cache.get(robot.user.id).roles.highest) > 0) {
        return interaction.editReply({ content: i18next.t('ban-js_user_above_bot_or_author'), ephemeral: true });
      }

      // Находим канал логирования на основе настроек сервера
      let logChannel;
      if (banLogChannelNameUse) {
        logChannel = guild.channels.cache?.find(ch => ch.name === banLogChannelName);
      } else {
        logChannel = guild.channels.cache?.find(ch => ch.name === logChannelName);
      }

      // Если канал логирования не существует, создаем его
      if (!logChannel) {
        const channelNameToCreate = banLogChannelNameUse ? banLogChannelName : logChannelName;
        const roles = interaction.guild.roles.cache;
        const higherRoles = roles.filter(role => botMember.roles.highest.comparePositionTo(role) < 0);
        const logChannelCreationResult = await createLogChannel(interaction, channelNameToCreate, botMember, higherRoles, serverSettings);

        // Выход из функции, если произошла ошибка при создании канала
        if (logChannelCreationResult.startsWith('Ошибка')) {
          return interaction.editReply({ content: logChannelCreationResult, ephemeral: true });
        }

        // Переопределяем переменную logChannel, так как она теперь может содержать новый канал
        logChannel = interaction.guild.channels.cache.find(ch => ch.name === channelNameToCreate);
      }

      // Баним пользователя с указанной причиной и удаляем его сообщения, если это разрешено
      await user.ban({ reason, days: deleteMessagesTime ? convertToMilliseconds(deleteMessagesTime) / (1000 * 60 * 60 * 24) : 0 });

      // Удаляем сообщения забаненного пользователя на основе настроек сервера и указанного периода времени
      const deletedMessagesCount = deletingMessagesFromBannedUsers && deleteMessagesTime !== '0' ? await deleteMessages(user, deleteMessagesTime, guild, logChannel) : 0;

      // Создаем вставку для регистрации события бана
      const EmbedBan = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle(i18next.t('ban-js_block_user_title'))
        .setDescription(i18next.t('ban-js_block_user_description', { user: userId, reason, deletedMessagesCount }))
        .setTimestamp()
        .setFooter({ text: i18next.t('ban-js_block_user_footer', { moderator: moderator.tag }) });

      // Отправляем вставку в канал журнала
      await logChannel.send({ embeds: [EmbedBan] });

      // Отвечаем пользователю, который выполнил команду, сообщением с подтверждением
      await interaction.editReply({ content: i18next.t('ban-js_block_user_log_moderator', { user: userId, deletedMessagesCount }), ephemeral: true });
    } catch (error) {
      console.error(`Произошла ошибка: ${error.message}`);
      return interaction.editReply({ content: i18next.t('Error'), ephemeral: true });
    }
  },
};