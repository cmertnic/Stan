// Импорт необходимых модулей и функций
const { Client,ChannelType, PermissionFlagsBits } = require('discord.js');
const { createMainLogChannel, createMutedRole } = require('../../events');
const { SlashCommandBuilder } = require('@discordjs/builders');
const { getServerSettings } = require('../../database/settingsDb');
const { i18next, t } = require('../../i18n');

function isLogChannelEnabled(actionType, serverSettings) {
    return serverSettings[actionType + 'LogChannelNameUse'];
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('test')
        .setDescription(i18next.t('test-js_description')),

    /**
     * Обработчик команды test
     * @param {import('discord.js').Client} robot - Экземпляр клиента Discord.js
     * @param {import('discord.js').Interaction} interaction - Объект взаимодействия с пользователем
     */
    async execute(robot, interaction) {
        let responseMessage = ''; // Переменная для хранения текста всех сообщений

        try {
            // Проверка взаимодействия
            if (interaction.user.bot) return;
            if (interaction.channel.type === ChannelType.DM) {
                responseMessage += i18next.t('error_private_messages') + '\n';
                await interaction.reply({ content: responseMessage, ephemeral: true });
                return;
            }

            // Ответ на команду
            await interaction.reply({ content: 'loading...', ephemeral: true });

            const member = interaction.member;
            if (!member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
                responseMessage += i18next.t('ModerateMembers_user_check') + '\n';
                await interaction.followUp({ content: responseMessage, ephemeral: true });
                return;
            }

            // Получение настроек сервера и бота
            const serverSettings = await getServerSettings(interaction.guild.id);
            const botMember = await interaction.guild.members.fetch(interaction.client.user.id);
            if (!botMember) {
                responseMessage += i18next.t('error_bot_member') + '\n';
                await interaction.followUp({ content: responseMessage, ephemeral: true });
                return;
            }

            // Получаем список всех ролей на сервере
            const roles = await interaction.guild.roles.fetch();
            const higherRoles = roles.filter(role => botMember.roles.highest.comparePositionTo(role) < 0);

            if (!botMember.permissions.has(PermissionFlagsBits.ModerateMembers)) {
                responseMessage += i18next.t('ModerateMembers_bot_check') + '\n';
                await interaction.followUp({ content: responseMessage, ephemeral: true });
                return;
            }

            if (interaction.member.roles.highest.comparePositionTo(botMember.roles.highest) <= 0) {
                responseMessage += i18next.t('error_highest_bot_role') + '\n';
                await interaction.followUp({ content: responseMessage, ephemeral: true });
                return;
            }

            // Создание или получение канала для логирования
            const logChannels = ['ban', 'clear', 'mute', 'kick', 'warn', 'report'];
            let logChannelsStatus = '';
            for (const actionType of logChannels) {
                if (isLogChannelEnabled(actionType, serverSettings)) {
                    const channel = await interaction.guild.channels.fetch(serverSettings[actionType + 'LogChannelName']);
                    if (channel) {
                        logChannelsStatus += `${actionType}: ✅ ${channel}\n`;
                    } else {
                        logChannelsStatus += `${actionType}: ❌ ${i18next.t('log_channel_not_found')}\n`;
                    }
                } else {
                    logChannelsStatus += `${actionType}: ❌ ${i18next.t('log_channel_disabled')}\n`;
                }
            }

            const logChannelName = serverSettings.logChannelName || 'main-log';
            const mainLogChannelMessage = await createMainLogChannel(interaction, logChannelName, botMember, higherRoles, serverSettings);
            responseMessage += `${mainLogChannelMessage}\n`;

            const mutedRoleMessage = await createMutedRole(interaction, serverSettings);
            responseMessage += `${mutedRoleMessage}\n`;

            // Отправка объединенного сообщения с статусом каналов логирования
            await interaction.followUp({ content: logChannelsStatus + responseMessage + i18next.t('test-js_sucess'), ephemeral: true });
        } catch (error) {
            console.error(`Произошла ошибка: ${error.message}`);
            return interaction.editReply({ content: i18next.t('Error'), ephemeral: true });
        }
    }
};