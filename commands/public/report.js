// Подключаем необходимые модули
const { createLogChannel } = require('../../events');
const { getServerSettings } = require('../../database/settingsDb');
const {Client ,ChannelType, EmbedBuilder,SlashCommandBuilder } = require('discord.js');
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
        if (interaction.channel.type === ChannelType.DM) {
            return await interaction.reply({ content: i18next.t('error_private_messages'), flags: 64  });
          }
        const commandCooldown = userCommandCooldowns.get(interaction.user.id);
        if (commandCooldown && commandCooldown.command === 'report' && Date.now() < commandCooldown.endsAt) {
          const timeLeft = Math.round((commandCooldown.endsAt - Date.now()) / 1000);
          return interaction.reply({ content: i18next.t(`cooldown`, { timeLeft: timeLeft}), flags: 64  });
        }
        // Откладываем ответ, чтобы бот не блокировался во время выполнения команды
        await interaction.deferReply({ flags: 64  });
        try {

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
                    return interaction.editReply({ content: logChannelCreationResult, flags: 64  });
                }

                // Переопределяем переменную logChannel, так как она теперь может содержать новый канал
                logChannel = interaction.guild.channels.cache.find(ch => ch.name === channelNameToCreate);
            }

            // Валидация ID пользователя и аргументов
            const userIdOrMention = interaction.options.getUser(USER_OPTION_NAME).id;
            const memberToReport = await interaction.guild.members.fetch(userIdOrMention).catch(() => null);
            if (!memberToReport) {
                return interaction.editReply({ content: i18next.t('repot-js_user_search_error'), flags: 64  });
            }

            // Определение причины жалобы
            const reason = interaction.options.getString(REASON_OPTION_NAME) || defaultReason;

            // Отправка сообщения в канал логирования
            try {
                const EmbedReportUser = new EmbedBuilder()
                .setColor(0xFFFF00) // Жёлтый цвет для сообщения о жалобе
                .setTitle(i18next.t('report-js_description'))
                .setDescription(i18next.t('report-js_user_log_channel', { reportmember: memberToReport.id, userTag: interaction.user.id, reason: reason }))
                .setTimestamp()
            
            await logChannel.send({ embeds: [EmbedReportUser] });
            } catch (error) {
                return interaction.editReply(interaction, { content: i18next.t(`Error_log`, { error: error }), flags: 64  });
            }
            userCommandCooldowns.set(interaction.user.id, { command: 'report', endsAt: Date.now() + 30000 });
            // Отправка сообщения о завершении выполнения команды
            await interaction.editReply({
                content: i18next.t(`report-js_user_log_moderator`, { reportmember: memberToReport.id, reason: reason }), flags: 64  
            });
        } catch (error) {
            console.error(`Произошла ошибка: ${error.message}`);
            return interaction.editReply({ content: i18next.t('Error'), flags: 64  });
        }
        setTimeout(() => {
            userCommandCooldowns.delete(interaction.user.id);
          }, 30000);
    }
};