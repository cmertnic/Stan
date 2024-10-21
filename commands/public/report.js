// Подключаем необходимые модули
const { createLogChannel } = require('../../events');
const { getServerSettings } = require('../../database/settingsDb');
const {Client ,ChannelType, SlashCommandBuilder } = require('discord.js');
const { i18next, t } = require('../../i18n');
const USER_OPTION_NAME = i18next.t('report-js_user');
const REASON_OPTION_NAME = i18next.t('report-js_reason');
const userCommandCooldowns = new Map();
module.exports = {
    data: new SlashCommandBuilder()
        .setName('report')
        .setDescription(i18next.t('report-js_description'))
        .addUserOption(option =>
            option.setName(USER_OPTION_NAME)
                .setDescription(i18next.t('report-js_user_description'))
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName(REASON_OPTION_NAME)
                .setDescription(i18next.t('report-js_reason_description'))
                .setRequired(false)
        ),

    /**
     * Обработчик команды /report
     * @param {Client} robot - экземпляр клиента Discord.js
     * @param {CommandInteraction} interaction - объект взаимодействия с командой
     */
    async execute(robot, interaction) {
        if (interaction.user.bot) return;
        const commandCooldown = userCommandCooldowns.get(interaction.user.id);
        if (commandCooldown && commandCooldown.command === 'report' && Date.now() < commandCooldown.endsAt) {
          const timeLeft = Math.round((commandCooldown.endsAt - Date.now()) / 1000);
          return interaction.reply({ content: i18next.t(`cooldown`, { timeLeft: timeLeft}), ephemeral: true });
        }
        // Откладываем ответ, чтобы бот не блокировался во время выполнения команды
        await interaction.deferReply({ ephemeral: true });
        try {
            // Проверка, что пользователь не бот
            if (interaction.user.bot) return;

            // Проверка, что команда не была вызвана в личных сообщениях
            if (interaction.channel.type === ChannelType.DM) {
                return interaction.editReply(i18next.t('error_private_messages'));
            }

            // Получение настроек сервера
            const serverSettings = await getServerSettings(interaction.guild.id);
            const reportLogChannelNameUse = serverSettings.reportLogChannelNameUse;
            const reportLogChannelName = serverSettings.reportLogChannelName;
            const logChannelName = serverSettings.logChannelName;
            const defaultReason = i18next.t('defaultReason');

            // Определение канала для логирования отчетов
            let logChannel;
            if (reportLogChannelNameUse) {
                logChannel = interaction.guild.channels.cache.find(ch => ch.name === reportLogChannelName);
            } else {
                logChannel = interaction.guild.channels.cache.find(ch => ch.name === logChannelName);
            }

            // Проверка на существование канала логирования
            if (!logChannel) {
                const channelNameToCreate = reportLogChannelNameUse ? reportLogChannelName : logChannelName;
                const roles = interaction.guild.roles.cache;
                const higherRoles = roles.filter(role => botMember.roles.highest.comparePositionTo(role) < 0);
                const logChannelCreationResult = await createLogChannel(interaction, channelNameToCreate, botMember, higherRoles);

                // Выход из функции, если произошла ошибка при создании канала
                if (logChannelCreationResult.startsWith('Ошибка')) {
                    return interaction.editReply({ content: logChannelCreationResult, ephemeral: true });
                }

                // Переопределяем переменную logChannel, так как она теперь может содержать новый канал
                logChannel = interaction.guild.channels.cache.find(ch => ch.name === channelNameToCreate);
            }

            // Валидация ID пользователя и аргументов
            const userIdOrMention = interaction.options.getUser(USER_OPTION_NAME).id;
            const memberToReport = await interaction.guild.members.fetch(userIdOrMention).catch(() => null);
            if (!memberToReport) {
                return interaction.editReply({ content: i18next.t('repot-js_user_search_error'), ephemeral: true });
            }

            // Определение причины жалобы
            const reason = interaction.options.getString(REASON_OPTION_NAME) || defaultReason;

            // Отправка сообщения в канал логирования
            try {
                await logChannel.send(i18next.t(`report-js_user_log_channel`, { userTag: interaction.user.id, reportmember: memberToReport.id, reason: reason }));
            } catch (error) {
                return interaction.editReply(interaction, { content: i18next.t(`Error_log`, { error: error }), ephemeral: true });
            }
            userCommandCooldowns.set(interaction.user.id, { command: 'report', endsAt: Date.now() + 30000 });
            // Отправка сообщения о завершении выполнения команды
            await interaction.editReply({ content: i18next.t(`report-js_user_log_moderator`, { reportmember: memberToReport.id, reason: reason }), ephemeral: true });
        } catch (error) {
            console.error(`Произошла ошибка: ${error.message}`);
            return interaction.editReply({ content: i18next.t('Error'), ephemeral: true });
        }
        setTimeout(() => {
            userCommandCooldowns.delete(interaction.user.id);
          }, 30000);
    }
};