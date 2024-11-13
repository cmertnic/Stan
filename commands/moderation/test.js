// Импорт необходимых модулей и функций
const { Client, ChannelType, PermissionFlagsBits } = require('discord.js');
const { createMainLogChannel, createLogChannel, createMutedRole } = require('../../events');
const { SlashCommandBuilder } = require('@discordjs/builders');
const { getServerSettings, saveServerSettings } = require('../../database/settingsDb');
const { i18next, t } = require('../../i18n');

function isLogChannelEnabled(actionType, serverSettings) {
    return serverSettings[actionType + 'LogChannelNameUse'];
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('test')
        .setDescription(i18next.t('test-js_description')),

    async execute(robot, interaction) {
        let responseMessage = '';

        try {
            if (interaction.user.bot) return;
            if (interaction.channel.type === ChannelType.DM) {
                return await interaction.reply({ content: i18next.t('error_private_messages'), ephemeral: true });
              }

            await interaction.reply({ content: 'loading...', ephemeral: true });

            const member = interaction.member;
            if (!member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
                responseMessage += `❌ ${i18next.t('ModerateMembers_user_check')}\n`;
                await interaction.followUp({ content: responseMessage, ephemeral: true });
                return;
            }

            const serverSettings = await getServerSettings(interaction.guild.id);
            const botMember = await interaction.guild.members.fetch(interaction.client.user.id);
            if (!botMember) {
                responseMessage += `❌ ${i18next.t('error_bot_member')}\n`;
                await interaction.followUp({ content: responseMessage, ephemeral: true });
                return;
            }

            const roles = await interaction.guild.roles.fetch();
            const higherRoles = roles.filter(role => botMember.roles.highest.comparePositionTo(role) < 0);

            if (!botMember.permissions.has(PermissionFlagsBits.ModerateMembers)) {
                responseMessage += `❌ ${i18next.t('ModerateMembers_bot_check')}\n`;
                await interaction.followUp({ content: responseMessage, ephemeral: true });
                return;
            }

            if (interaction.member.roles.highest.comparePositionTo(botMember.roles.highest) <= 0) {
                responseMessage += `❌ ${i18next.t('error_highest_bot_role')}\n`;
                await interaction.followUp({ content: responseMessage, ephemeral: true });
                return;
            }

            // Создание основного канала логирования
            const logChannelName = serverSettings.logChannelName || 'main-log';
            const mainLogChannelMessage = await createMainLogChannel(interaction, logChannelName, botMember, higherRoles, serverSettings);
            responseMessage += `✅ ${mainLogChannelMessage}\n`;

            // Создание побочных каналов логирования
            const logChannels = ['ban', 'clear', 'mute', 'kick', 'warn', 'report'];
            for (const actionType of logChannels) {
                if (isLogChannelEnabled(actionType, serverSettings)) {
                    const channelName = serverSettings[actionType + 'LogChannelName'];
                    const logChannelMessage = await createLogChannel(interaction, channelName, botMember, higherRoles);
                    responseMessage += `✅ ${logChannelMessage}\n`;
                } else {
                    responseMessage += `❌ Лог-канал для ${actionType} отключен.\n`;
                }
            }

            // Создание роли для замьюченых пользователей
            const mutedRoleMessage = await createMutedRole(interaction, serverSettings);
            responseMessage += `✅ ${mutedRoleMessage}\n`;

            await interaction.followUp({ content: responseMessage + `✅ ${i18next.t('test-js_sucess')}`, ephemeral: true });
        } catch (error) {
            console.error(`Произошла ошибка: ${error.message}`);
            return interaction.editReply({ content: `❌ ${i18next.t('Error')}`, ephemeral: true });
        }
    }
};