// Импортируем необходимые классы и модули
const { Client, ChannelType, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getUserWarnings, removeWarningFromDatabase } = require('../../database/warningsDb');
const { validateUserId, createLogChannel } = require('../../events');
const { getServerSettings } = require('../../database/settingsDb');
const { i18next, t } = require('../../i18n');
const USER_OPTION_NAME = (i18next.t('deletewarn-js_user'));
const REASON_OPTION_NAME = (i18next.t('deletewarn-js_reason'));

// Экспорт команды
module.exports = {
    data: new SlashCommandBuilder()
        .setName('deletewarn')
        .setDescription(i18next.t('deletewarn-js_description'))
        .addUserOption(option =>
            option.setName(USER_OPTION_NAME)
                .setDescription(i18next.t('deletewarn-js_user_description'))
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName(REASON_OPTION_NAME)
                .setDescription(i18next.t('deletewarn-js_reason_description'))
                .setRequired(false)
        ),
    /**
     * Выполнение команды
     * @param {Client} robot - экземпляр клиента Discord.js
     * @param {CommandInteraction} interaction - объект взаимодействия с пользователем
     */
    // Обработчик команды
    async execute(robot, interaction) {
        // Откладываем ответ, чтобы бот не блокировался во время выполнения команды
        await interaction.deferReply({ ephemeral: true });
        try {
            // Предварительные проверки
            if (interaction.user.bot) return;
            if (interaction.channel.type === ChannelType.DM) {
                return await interaction.reply({ content: i18next.t('error_private_messages'), ephemeral: true });
              }
            if (!interaction.member.permissions.has('ModerateMembers')) {
                return interaction.editReply({ content: i18next.t('ModerateMembers_user_check'), ephemeral: true });
            }

            const botMember = await interaction.guild.members.fetch(interaction.client.user.id);
            if (!botMember) {
                throw new Error(i18next.t('error_bot_member'));
            }
            // Проверка прав бота
            if (!botMember.permissions.has('ModerateMembers')) {
                return interaction.editReply({ content: i18next.t('ModerateMembers_bot_check'), ephemeral: true });
            }

            // Получение настроек сервера
            const serverSettings = await getServerSettings(interaction.guild.id);
            const logChannelName = serverSettings.logChannelName;
            const warningLogChannelName = serverSettings.warningLogChannelName;
            const warningLogChannelNameUse = serverSettings.warningLogChannelNameUse;
            const defaultReason = i18next.t('defaultReason');

            // Разбор аргументов команды и валидация ID пользователя
            let userIdToDeleteWarning = interaction.options.getUser(USER_OPTION_NAME).id;
            userIdToDeleteWarning = validateUserId(userIdToDeleteWarning);
            if (!userIdToDeleteWarning) {
                return interaction.editReply({ content: i18next.t('error_id_or_tag'), ephemeral: true });
            }

            // Получение информации о предупреждениях пользователя
            const userWarnings = await getUserWarnings(userIdToDeleteWarning);
            if (userWarnings.length === 0) {
                return interaction.editReply({ content: i18next.t('deletewarn-js_error_non_active_warn'), ephemeral: true });
            }

            // Сортировка предупреждений по времени истечения (от самого свежего к старому)
            userWarnings.sort((a, b) => b.unmuteTime - a.unmuteTime);

            // Удаление самого свежего предупреждения
            const latestWarning = userWarnings[0];
            await removeWarningFromDatabase(robot, interaction.guild.id, latestWarning.userId);

            // Определение причины удаления предупреждения
            const reason = interaction.options.getString(REASON_OPTION_NAME) || defaultReason;

            // Логирование действия
            let logChannel;
            if (warningLogChannelNameUse) {
                logChannel = interaction.guild.channels.cache.find(ch => ch.name === warningLogChannelName);
            } else {
                logChannel = interaction.guild.channels.cache.find(ch => ch.name === logChannelName);
            }

            // Проверка и создание лог-канала, если он не найден
            if (!logChannel) {
                const channelNameToCreate = warningLogChannelNameUse ? warningLogChannelName : logChannelName;
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

            // Логирование действия
            const EmbedDeleteWarning = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle(i18next.t('deletewarn-js_delete_warning_title'))
                .setDescription(i18next.t(`deletewarn-js_delete_warning_log_channel`, {
                    userIdToDeleteWarning: userIdToDeleteWarning, reason: reason
                }))
                .setTimestamp()
                .setFooter({ text: i18next.t('deletewarn-js_delete_warning_footer', { moderator: interaction.user.tag }) });

            await logChannel.send({ embeds: [EmbedDeleteWarning] });
            // Отправка сообщения о завершении выполнения команды
            await interaction.editReply({ content: i18next.t('deletewarn-js_block_user_mod', { userIdToDeleteWarning: userIdToDeleteWarning, reason: reason }), ephemeral: true });
        } catch (error) {
            console.error(`Произошла ошибка: ${error.message}`);
            return interaction.editReply({ content: i18next.t('Error'), ephemeral: true });
        }
    }
};