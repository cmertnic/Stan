// Импорт необходимых модулей и функций
const { Client, ChannelType, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const schedule = require('node-schedule');
const { createLogChannel } = require('../../events');
const { getServerSettings } = require('../../database/settingsDb');
const { saveWarningToDatabase, removeWarningFromDatabase, getWarningsCount } = require('../../database/warningsDb');
const { formatDuration, convertToMilliseconds, notifyUserAndLogWarn } = require('../../events');
const { i18next, t } = require('../../i18n');
const USER_OPTION_NAME = t('warn-js_user');
const REASON_OPTION_NAME = t('warn-js_reason');
const TIME_OPTION_NAME = t('warn-js_time');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warn')
        .setDescription(i18next.t('warn-js_description'))
        .addUserOption(option => option
            .setName(USER_OPTION_NAME)
            .setDescription(i18next.t('warn-js_user_description'))
            .setRequired(true))
        .addStringOption(option => option
            .setName(REASON_OPTION_NAME)
            .setDescription(i18next.t('warn-js_reason_description'))
            .setRequired(false))
        .addStringOption(option => option
            .setName(TIME_OPTION_NAME)
            .setDescription(i18next.t('warn-js_time_description'))
            .setRequired(false)),
    /**
         * @param {Client} robot - экземпляр Discord.js Client
         * @param {CommandInteraction} interaction - объект Interaction от Discord.js
         */
    async execute(robot, interaction, database) {
        if (interaction.user.bot) return;
        if (interaction.channel.type === ChannelType.DM) {
            return await interaction.reply({ content: i18next.t('error_private_messages'), flags: 64  });
          }
        // Откладываем ответ, чтобы бот не блокировался во время выполнения команды
        await interaction.deferReply({ flags: 64  });
        let hasReplied = false; // Флаг для отслеживания, был ли отправлен ответ

        try {
            if (interaction.user.bot || interaction.channel.type === ChannelType.DM) return;

            const serverSettings = await getServerSettings(interaction.guild.id);
            const warningDuration = serverSettings.warningDuration;
            const defaultReason = 'Не указана';
            const maxWarnings = serverSettings.maxWarnings || 3;
            const logChannelName = serverSettings.logChannelName;
            const warningLogChannelName = serverSettings.warningLogChannelName;
            const warningLogChannelNameUse = serverSettings.warningLogChannelNameUse;

            let logChannel;
            if (warningLogChannelNameUse) {
                logChannel = interaction.guild.channels.cache.find(ch => ch.name === warningLogChannelName);
            } else {
                logChannel = interaction.guild.channels.cache.find(ch => ch.name === logChannelName);
            }

            if (!logChannel) {
                const channelNameToCreate = warningLogChannelNameUse ? warningLogChannelName : logChannelName;
                const botMember = interaction.guild.members.cache.get(robot.user.id);
                const higherRoles = interaction.guild.roles.cache.filter(role => botMember.roles.highest.comparePositionTo(role) < 0);

                const logChannelCreationResult = await createLogChannel(interaction, channelNameToCreate, botMember, higherRoles, serverSettings);

                if (logChannelCreationResult.startsWith('Ошибка')) {
                    await interaction.editReply({ content: logChannelCreationResult, flags: 64  });
                    hasReplied = true; // Устанавливаем флаг, что ответ был отправлен
                    return;
                }

                logChannel = interaction.guild.channels.cache.find(ch => ch.name === channelNameToCreate);
            }

            if (!interaction.member.permissions.has('ModerateMembers') || !interaction.guild) {
                await interaction.editReply({ content: i18next.t('ModerateMembers_user_check'), flags: 64  });
                hasReplied = true;
                return;
            }

            if (!interaction.guild.members.cache.get(robot.user.id).permissions.has('ModerateMembers')) {
                await interaction.editReply({ content: i18next.t('ModerateMembers_bot_check'), flags: 64  });
                hasReplied = true;
                return;
            }

            const userIdToWarn = interaction.options.getUser (USER_OPTION_NAME).id;
            if (!userIdToWarn) {
                await interaction.editReply({ content: i18next.t('warn-js_error_user_id'), flags: 64  });
                hasReplied = true;
                return;
            }

            const memberToWarn = await interaction.guild.members.fetch(userIdToWarn).catch(console.error);

            if (interaction.member.roles.highest.comparePositionTo(memberToWarn.roles.highest) <= 0) {
                await interaction.editReply({ content: i18next.t('warn-js_hierarchy_bot'), flags: 64  });
                hasReplied = true;
                return;
            }

            if (interaction.guild.members.cache.get(robot.user.id).roles.highest.comparePositionTo(memberToWarn.roles.highest) <= 0) {
                await interaction.editReply({ content: i18next.t('warn-js_hierarchy_user'), flags: 64  });
                hasReplied = true;
                return;
            }

            const inputDuration = interaction.options.getString(TIME_OPTION_NAME);
            const inputReason = interaction.options.getString(REASON_OPTION_NAME) || defaultReason;

            const duration = inputDuration ? convertToMilliseconds(inputDuration) : convertToMilliseconds(warningDuration);
            const reason = inputReason;

            const formattedDuration = formatDuration(duration);
            if (!formattedDuration) {
                await interaction.editReply({ content: t('warn-js_error_inkorect_duration'), flags: 64  });
                hasReplied = true;
                return;
            }

            const warningsCount = await getWarningsCount(userIdToWarn);
            if (warningsCount >= maxWarnings) {
                await interaction.editReply({ content: t(`warn-js_max_warns`, { userIdToWarn, maxWarnings }), flags: 64  });
                hasReplied = true;
                await logChannel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xFF0000)
                            .setTitle(i18next.t('warn-js_max_warns_title'))
                            .setDescription(i18next.t('warn-js_max_warns_desc', { userIdToWarn, maxWarnings }))
                            .setTimestamp()
                            .setFooter({ text: i18next.t('warn-js_max_warns_footer', { moderator: interaction.user.tag }) }),
                    ],
                });
                return;
            }

            const warningId = await saveWarningToDatabase(interaction, userIdToWarn, duration, reason);
            await notifyUserAndLogWarn(interaction, memberToWarn, formattedDuration, reason);

            const removalDate = new Date(Date.now() + duration);
            schedule.scheduleJob(removalDate, async () => {
                await removeWarningFromDatabase(database, warningId)
                    .catch(error => console.error(`Ошибка при удалении предупреждения: ${error}`));
            });

            await interaction.editReply({ content: i18next.t(`warn-js_warn_user_log_moderator`, { memberToWarn: memberToWarn.id, formattedDuration, reason }), flags: 64  });
            hasReplied = true; // Устанавливаем флаг, что ответ был отправлен
        } catch (error) {
            console.error(`Произошла ошибка: ${error.message}`);
            if (!hasReplied) {
                await interaction.editReply({ content: i18next.t('Error'), flags: 64  });
            }
        }
    },
};
