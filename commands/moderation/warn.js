// Импорт необходимых модулей и функций
const { Client, ChannelType, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const schedule = require('node-schedule');
const { getServerSettings, createLogChannel } = require('../../database/settingsDb');
const { saveWarningToDatabase, removeWarningFromDatabase, getWarningsCount } = require('../../database/warningsDb');
const { formatDuration, convertToMilliseconds, notifyUserAndLogWarn } = require('../../events');
const { i18next, t } = require('../../i18n');
const USER_OPTION_NAME = t('warn-js_user');
const REASON_OPTION_NAME = t('warn-js_reason');
const TIME_OPTION_NAME = t('warn-js_time');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warn')
        .setDescription(t('warn-js_description'))
        .addUserOption(option => option
            .setName(USER_OPTION_NAME)
            .setDescription(t('warn-js_user_description'))
            .setRequired(true))
        .addStringOption(option => option
            .setName(REASON_OPTION_NAME)
            .setDescription(t('warn-js_reason_description'))
            .setRequired(false))
        .addStringOption(option => option
            .setName(TIME_OPTION_NAME)
            .setDescription(t('warn-js_time_description'))
            .setRequired(false)),
    /**
         * @param {Client} robot - экземпляр Discord.js Client
         * @param {CommandInteraction} interaction - объектInteraction от Discord.js
         */
    async execute(robot, interaction, database) {
        // Откладываем ответ, чтобы бот не блокировался во время выполнения команды
        await interaction.deferReply({ ephemeral: true });
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
                    return interaction.editReply({ content: logChannelCreationResult, ephemeral: true });
                }

                logChannel = interaction.guild.channels.cache.find(ch => ch.name === channelNameToCreate);
            }

            if (!interaction.member.permissions.has('ModerateMembers') || !interaction.guild) {
                return interaction.editReply({ content: t('ModerateMembers_user_check'), ephemeral: true });
            }

            if (!interaction.guild.members.cache.get(robot.user.id).permissions.has('ModerateMembers')) {
                return interaction.editReply({ content: t('ModerateMembers_bot_check'), ephemeral: true });
            }

            const userIdToWarn = interaction.options.getUser(USER_OPTION_NAME).id;
            if (!userIdToWarn) {
                return interaction.editReply({ content: t('warn-js_error_user_id'), ephemeral: true });
            }

            const memberToWarn = await interaction.guild.members.fetch(userIdToWarn).catch(console.error);

            if (interaction.member.roles.highest.comparePositionTo(memberToWarn.roles.highest) <= 0) {
                return interaction.editReply({ content: t('warn-js_hierarchy_bot'), ephemeral: true });
            }

            if (interaction.guild.members.cache.get(robot.user.id).roles.highest.comparePositionTo(memberToWarn.roles.highest) <= 0) {
                return interaction.editReply({ content: t('warn-js_hierarchy_user'), ephemeral: true });
            }

            const inputDuration = interaction.options.getString(TIME_OPTION_NAME);
            const inputReason = interaction.options.getString(REASON_OPTION_NAME) || defaultReason;

            const duration = inputDuration ? convertToMilliseconds(inputDuration) : convertToMilliseconds(warningDuration);
            const reason = inputReason;

            const formattedDuration = formatDuration(duration);
            if (!formattedDuration) {
                return interaction.editReply({ content: t('warn-js_error_inkorect_duration'), ephemeral: true });
            }

            const warningsCount = await getWarningsCount(userIdToWarn);
            if (warningsCount >= maxWarnings) {
                await interaction.editReply({ content: t(`warn-js_max_warns`, { userIdToWarn, maxWarnings }), ephemeral: true });
                await logChannel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xFF0000)
                            .setTitle(t('warn-js_max_warns_title'))
                            .setDescription(t('warn-js_max_warns_desc', { userIdToWarn, maxWarnings }))
                            .setTimestamp()
                            .setFooter({ text: t('warn-js_max_warns_footer', { moderator: interaction.user.tag }) }),
                    ],
                });
                return;
            }

            try {
                const warningId = await saveWarningToDatabase(interaction, userIdToWarn, duration, reason);
                await notifyUserAndLogWarn(interaction, memberToWarn, formattedDuration, reason);

                const removalDate = new Date(Date.now() + duration);
                schedule.scheduleJob(removalDate, async () => {
                    await removeWarningFromDatabase(database, warningId)
                        .catch(error => console.error(`Ошибка при удалении предупреждения: ${error}`));
                });
            } catch (error) {
                console.error(`Ошибка при выполнении функции warn: ${error}`);
            }

            await interaction.reply({ content: t(`warn-js_warn_user_log_moderator`, { memberToWarn: memberToWarn.id, formattedDuration, reason }), ephemeral: true });
        } catch (error) {
            console.error(`Произошла ошибка: ${error.message}`);
            return interaction.editReply({ content: i18next.t('Error'), ephemeral: true });
        }

    },
};