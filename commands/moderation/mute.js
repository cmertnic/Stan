// Импорт необходимых модулей и функций
const { Client, SlashCommandBuilder, ChannelType } = require('discord.js');
require('dotenv').config();
const { saveMuteToDatabase, removeMuteFromDatabase } = require('../../database/mutesDb');
const { createMutedRole, formatDuration, convertToMilliseconds, notifyUserAndLogMute } = require('../../events');
const { getServerSettings } = require('../../database/settingsDb');
const schedule = require('node-schedule');
const { i18next, t } = require('../../i18n');

const USER_OPTION_NAME = i18next.t('mute-js_user');
const REASON_OPTION_NAME = i18next.t('mute-js_reason');
const TIME_OPTION_NAME = i18next.t('mute-js_time');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mute')
        .setDescription(i18next.t('mute-js_description'))
        .addUserOption(option =>
            option.setName(USER_OPTION_NAME)
                .setDescription(i18next.t('mute-js_user_description'))
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName(REASON_OPTION_NAME)
                .setDescription(i18next.t('mute-js_reason_description'))
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName(TIME_OPTION_NAME)
                .setDescription(i18next.t('mute-js_time_description'))
                .setRequired(false)
        ),
    /**
* Выполнение команды
* @param {Client} robot - экземпляр клиента Discord.js
* @param {CommandInteraction} interaction - объект взаимодействия с пользователем
*/
    async execute(robot, interaction) {
        // Откладываем ответ, чтобы бот не блокировался во время выполнения команды
        await interaction.deferReply({ ephemeral: true });
        try {
            // Проверки и инициализация переменных
            if (interaction.user.bot) return;
            if (interaction.channel.type === ChannelType.DM) {
                return interaction.editReply(i18next.t('error_private_messages'));
            }

            const serverSettings = await getServerSettings(interaction.guild.id);
            const mutedRoleName = serverSettings.mutedRoleName;
            const defaultDuration = serverSettings.muteDuration;
            const defaultReason = i18next.t('defaultReason');
            const mutedRole = interaction.guild.roles.cache.find(role => role.name === mutedRoleName);

            await createMutedRole(interaction, serverSettings);

            if (!mutedRole) {
                return interaction.editReply({ content: i18next.t('mute-js_role_muted_error', { mutedRole: mutedRoleName }), ephemeral: true });
            }

            const userIdToMute = interaction.options.getUser(USER_OPTION_NAME).id;
            const memberToMute = await interaction.guild.members.fetch(userIdToMute).catch(() => null);

            if (!memberToMute) {
                return interaction.editReply({ content: i18next.t('mute-js_user_search_error'), ephemeral: true });
            }

            // Проверки прав пользователя и бота
            if (!interaction.member.permissions.has('ModerateMembers')) {
                return interaction.editReply({ content: i18next.t('ModerateMembers_user_check'), ephemeral: true });
            }

            const botMember = await interaction.guild.members.fetch(interaction.client.user.id);
            if (!botMember.permissions.has('ModerateMembers')) {
                return interaction.editReply({ content: i18next.t('ModerateMembers_bot_check'), ephemeral: true });
            }

            if (botMember.roles.highest.comparePositionTo(memberToMute.roles.highest) <= 0) {
                return interaction.editReply({ content: i18next.t('error_highest_role'), ephemeral: true });
            }

            // Проверка, что пользователь не замьючен
            if (memberToMute.roles.cache.some(role => role.name === mutedRoleName)) {
                return interaction.editReply({ content: i18next.t('mute-js_mute_error'), ephemeral: true });
            }

            // Определение причины и продолжительности мута
            const inputDuration = interaction.options.getString(TIME_OPTION_NAME);
            const duration = inputDuration ? convertToMilliseconds(inputDuration) : convertToMilliseconds(defaultDuration);

            const reason = interaction.options.getString(REASON_OPTION_NAME) || defaultReason;

            // Применение мута
            await memberToMute.roles.add(mutedRole.id);

            // Сохранение мута в базу данных и планирование автоматического снятия мута
            const muteEndTimestamp = Date.now() + duration;
            await saveMuteToDatabase(interaction.guild.id, userIdToMute, muteEndTimestamp, reason, duration);

            const durationn = formatDuration(duration);

            // Уведомление пользователя и логирование мута
            await notifyUserAndLogMute(interaction, memberToMute, botMember, reason, durationn, interaction.user.id);

            // Планирование автоматического снятия мута
            const guildId = interaction.guild.id;
            const date = new Date(muteEndTimestamp);
            schedule.scheduleJob(date, async () => {
                await removeMuteFromDatabase(robot, guildId, userIdToMute);
            });

            // Отправка сообщения о завершении выполнения команды
            await interaction.editReply({ content: i18next.t('mute-js_mute_completed', { userIdToMute: userIdToMute, durationn: durationn }), ephemeral: true });
        } catch (error) {
            console.error(`Произошла ошибка: ${error.message}`);
            return interaction.editReply({ content: i18next.t('Error'), ephemeral: true });
        }

    }
};