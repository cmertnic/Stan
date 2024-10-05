// Импорт необходимых модулей и функций
const { Client, SlashCommandBuilder, ChannelType, EmbedBuilder } = require('discord.js');
const { getServerSettings } = require('../../database/settingsDb');
const { createLogChannel } = require('../../events');
const { i18next, t } = require('../../i18n');

const USER_OPTION_NAME = i18next.t('unban-js_user');
const REASON_OPTION_NAME = i18next.t('unban-js_reason');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unban')
        .setDescription(i18next.t('unban-js_description'))
        .addUserOption(option =>
            option.setName(USER_OPTION_NAME)
                .setDescription(i18next.t('unban-js_user_description'))
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName(REASON_OPTION_NAME)
                .setDescription(i18next.t('unban-js_reason_description'))
                .setRequired(false)
        ),

    /**
     * @param {Client} robot - экземпляр клиента Discord.js
     * @param {CommandInteraction} interaction - объект взаимодействия с пользователем
     */
    async execute(robot, interaction) {
        // Откладываем ответ, чтобы бот не блокировался во время выполнения команды
        await interaction.deferReply({ ephemeral: true });

        try {
            let userId;
            let reason;

            // Предварительные проверки
            if (interaction.user.bot) return;
            if (interaction.channel.type === ChannelType.DM) {
                return interaction.editReply(i18next.t('error_private_messages'));
            }

            // Получение ID пользователя и причины разблокировки
            userId = interaction.options.getUser(USER_OPTION_NAME).id;
            reason = interaction.options.getString(REASON_OPTION_NAME) || i18next.t('defaultReason');

            const member = interaction.member;
            const botMember = await interaction.guild.members.fetch(robot.user.id);

            // Получение настроек сервера
            const serverSettings = await getServerSettings(interaction.guild.id);
            const logChannelName = serverSettings.logChannelName;
            const banLogChannelName = serverSettings.banLogChannelName;
            const banLogChannelNameUse = serverSettings.banLogChannelNameUse;

            // Получение канала для логирования
            let logChannel;
            if (banLogChannelNameUse) {
                logChannel = interaction.guild.channels.cache.find(ch => ch.name === banLogChannelName);
            } else {
                logChannel = interaction.guild.channels.cache.find(ch => ch.name === logChannelName);
            }

            // Проверка наличия канала для логирования
            if (!logChannel) {
                const channelNameToCreate = banLogChannelNameUse ? banLogChannelName : logChannelName;
                const roles = interaction.guild.roles.cache;
                const higherRoles = roles.filter(role => botMember.roles.highest.comparePositionTo(role) < 0);
                const logChannelCreationResult = await createLogChannel(interaction, channelNameToCreate, botMember, higherRoles, serverSettings);

                if (logChannelCreationResult.startsWith('Ошибка')) {
                    return interaction.editReply({ content: logChannelCreationResult, ephemeral: true });
                }

                // Переопределяем переменную logChannel, так как она теперь может содержать новый канал
                logChannel = guild.channels.cache.find(ch => ch.name === channelNameToCreate);
            }

            // Проверки наличия необходимых элементов
            if (!userId) {
                return interaction.editReply({ content: i18next.t('error_id_or_tag'), ephemeral: true });

            }

            // Проверка прав пользователя и бота
            if (!member.permissions.has('BanMembers')) {
                return interaction.editReply({ content: i18next.t('BanMembers_user_check'), ephemeral: true });
            }

            if (!botMember.permissions.has('BanMembers')) {
                return interaction.editReply({ content: i18next.t('BanMembers_bot_check'), ephemeral: true });
            }

            // Проверка, заблокирован ли пользователь
            const bans = await interaction.guild.bans.fetch();
            if (!bans.has(userId)) {
                return interaction.editReply({ content: i18next.t('unban-js_user_not_blocked'), ephemeral: true });
            }

            // Разблокировка пользователя
            await interaction.guild.members.unban(userId, { reason });

            // Отправка сообщения в канал логирования
            const EmbedUnban = new EmbedBuilder()
                .setColor(0x0099FF) // Измените цвет по желанию
                .setTitle(i18next.t('unban-js_unban_user_title'))
                .setDescription(i18next.t(`unban-js_unban_user_log_channel`, { userId: userId, reason: reason }))
                .setTimestamp()
                .setFooter({ text: i18next.t('unban-js_unban_user_footer', { moderator: interaction.user.tag }) });

            await logChannel.send({ embeds: [EmbedUnban] });

            // Отправка сообщения о завершении выполнения команды
            await interaction.editReply({ content: i18next.t(`unban-js_unban_user_log_moderator`, { userId: userId, reason: reason }), ephemeral: true });
        } catch (error) {
            console.error(`Произошла ошибка: ${error.message}`);
            return interaction.editReply({ content: i18next.t('Error'), ephemeral: true });
        }
    }
};