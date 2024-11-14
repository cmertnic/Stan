const { SlashCommandBuilder } = require('@discordjs/builders');
const { ChannelType, EmbedBuilder } = require('discord.js');
const { i18next } = require('../../i18n');
const { createMainLogChannel } = require('../../events');
const { getServerSettings } = require('../../database/settingsDb');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('verify')
        .setDescription(i18next.t('verify-js_description'))
        .addUserOption(option => option
            .setName('user')
            .setDescription(i18next.t('verify-js_description'))
            .setRequired(true))
        .addStringOption(option => option
            .setName('action')
            .setDescription(i18next.t('verify-js_action'))
            .setRequired(true)
            .addChoices(
                { name: i18next.t('verify-js_give_role'), value: 'give_role' },
                { name: i18next.t('verify-js_deny_access'), value: 'deny_access' },
                { name: i18next.t('verify-js_change_gender'), value: 'change_gender' }
            ))
        .addStringOption(option => option
            .setName('gender')
            .setDescription('Change gender')
            .setRequired(false)
            .addChoices(
                { name: i18next.t('verify-js_Man'), value: 'male' },
                { name: i18next.t('verify-js_Women'), value: 'female' }
            )),
    async execute(robot, interaction) {
        if (interaction.user.bot) return;
        if (interaction.channel.type === ChannelType.DM) {
            return await interaction.reply({ content: i18next.t('error_private_messages'), ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });

        try {
            const userIdToVerify = interaction.options.getUser ('user').id;
            const action = interaction.options.getString('action');
            const memberToVerify = await interaction.guild.members.fetch(userIdToVerify);

            if (!memberToVerify) {
                return await interaction.editReply({ content: i18next.t('User _not_found'), ephemeral: true });
            }

            // Получение настроек сервера
            const serverSettings = await getServerSettings(interaction.guild.id);
            const { logChannelName, manRoleName, girlRoleName, newMemberRoleName } = serverSettings;
            const gender = interaction.options.getString('gender');
            const botMember = interaction.guild.members.me;
            let logChannel = interaction.guild.channels.cache.find(ch => ch.name === logChannelName);

            // Проверка и создание лог-канала, если он не найден
            if (!logChannel) {
                const channelCreationMessage = await createMainLogChannel(interaction, logChannelName, botMember, interaction.guild.roles.cache.filter(role => botMember.roles.highest.comparePositionTo(role) < 0), serverSettings);
                console.log(channelCreationMessage);
                logChannel = interaction.guild.channels.cache.find(ch => ch.name === logChannelName);
                if (!logChannel) {
                    return await interaction.editReply({ content: 'Не удалось создать или найти канал логов.', ephemeral: true });
                }
            }

            // Проверка прав на отправку сообщений
            if (!logChannel.permissionsFor(botMember).has('SEND_MESSAGES')) {
                return await interaction.editReply({ content: 'У бота нет прав на отправку сообщений в канал логов.', ephemeral: true });
            }

            switch (action) {
                case 'give_role':
                    let roleToAssign;
                    if (gender === 'male') {
                        roleToAssign = interaction.guild.roles.cache.find(role => role.name === manRoleName);
                    } else if (gender === 'female') {
                        roleToAssign = interaction.guild.roles.cache.find(role => role.name === girlRoleName);
                    } else {
                        return await interaction.editReply({ content: i18next.t('verify-js_gender_not_found'), ephemeral: true });
                    }

                    if (roleToAssign) {
                        // Проверяем, есть ли уже у пользователя эта роль
                        if (memberToVerify.roles.cache.has(roleToAssign.id)) {
                            return await interaction.editReply({ content: i18next.t('verify-js_role_already_declared', { rolename: roleToAssign.name }), ephemeral: true });
                        }

                        await memberToVerify.roles.add(roleToAssign);
                        await interaction.editReply({ content: i18next.t('verify-js_role_add', { rolename: roleToAssign.name, userIdToVerify: userIdToVerify }), ephemeral: true });

                        // Убираем роль "Новичок", если она есть
                        const rookieRole = interaction.guild.roles.cache.find(role => role.name === newMemberRoleName);
                        if (rookieRole && memberToVerify.roles.cache.has(rookieRole.id)) {
                            await memberToVerify.roles.remove(rookieRole);
                            console.log(`Роль "Новичок" была удалена у пользователя ${userIdToVerify}.`);
                        }

                        // Отправка личного сообщения пользователю
                        try {
                            await memberToVerify.send(i18next.t('verify-js_role_assigned_message', { rolename: roleToAssign.name, moderator: interaction.user.id }));
                        } catch (error) {
                            console.error(`Не удалось отправить личное сообщение пользователю: ${error.message}`);
                        }

                        // Создание embed для лога в канале логов
                        const genderSelectEmbed = new EmbedBuilder()
                            .setColor(0x00FF00)
                            .setTitle(i18next.t('verify-js_role_given_log_title'))
                            .setDescription(i18next.t('verify-js_role_given_log', { member: memberToVerify.id, role: roleToAssign.name }))
                            .setTimestamp()
                            .setFooter({ text: i18next.t('verify-js_log_footer', { moderator: interaction.user.tag }) });

                        // Отправка embed в канал логов
                        await logChannel.send({ embeds: [genderSelectEmbed] });
                    } else {
                        await interaction.editReply({ content: 'Роль не найдена.', ephemeral: true });
                    }
                    break;

                case 'deny_access':
                    const reason = 'Non-admission';
                    await memberToVerify.ban({ reason }).catch(error => {
                        console.error(`Ошибка при бане пользователя: ${error.message}`);
                        return interaction.editReply({ content: i18next.t('Error'), ephemeral: true });
                    });
                    await interaction.editReply({ content: i18next.t('verify-js_user_banned_log', { member: memberToVerify.id, reason }), ephemeral: true });

                    // Создание embed для лога в канале логов
                    const banEmbed = new EmbedBuilder()
                        .setColor(0xFF0000)
                        .setTitle(i18next.t('verify-js_user_banned_log_title'))
                        .setDescription(i18next.t('verify-js_user_banned_log', { member: memberToVerify.id, reason }))
                        .setTimestamp()
                        .setFooter({ text: i18next.t('verify-js_log_footer', { moderator: interaction.user.tag }) });

                    // Отправка embed в канал логов
                    await logChannel.send({ embeds: [banEmbed] });
                    break;

                case 'change_gender':
                    const maleRole = interaction.guild.roles.cache.find(role => role.name === manRoleName);
                    const femaleRole = interaction.guild.roles.cache.find(role => role.name === girlRoleName);

                    if (gender === 'male' && femaleRole && memberToVerify.roles.cache.has(femaleRole.id)) {
                        await memberToVerify.roles.remove(femaleRole);
                        await memberToVerify.roles.add(maleRole);
                        await interaction.editReply({ content: i18next.t('verify-js_gender_changed_log_title'), ephemeral: true });

                        // Создание embed для лога в канале логов
                        const genderChangeEmbedMale = new EmbedBuilder()
                            .setColor(0xFFFF00)
                            .setTitle(i18next.t('verify-js_gender_changed_log_title'))
                            .setDescription(i18next.t('verify-js_gender_changed_log', { member: memberToVerify.id, gender: 'Мужской' }))
                            .setTimestamp()
                            .setFooter({ text: i18next.t('verify-js_log_footer', { moderator: interaction.user.tag }) });

                        // Отправка embed в канал логов
                        await logChannel.send({ embeds: [genderChangeEmbedMale] });
                    } else if (gender === 'female' && maleRole && memberToVerify.roles.cache.has(maleRole.id)) {
                        await memberToVerify.roles.remove(maleRole);
                        await memberToVerify.roles.add(femaleRole);
                        await interaction.editReply({ content: i18next.t('verify-js_gender_changed_log_title'), ephemeral: true });

                        // Создание embed для лога в канале логов
                        const genderChangeEmbedFemale = new EmbedBuilder()
                            .setColor(0xFFFF00)
                            .setTitle(i18next.t('verify-js_gender_changed_log_title'))
                            .setDescription(i18next.t('verify-js_gender_changed_log', { member: memberToVerify.id, gender: 'Женский' }))
                            .setTimestamp()
                            .setFooter({ text: i18next.t('verify-js_log_footer', { moderator: interaction.user.tag }) });

                        // Отправка embed в канал логов
                        await logChannel.send({ embeds: [genderChangeEmbedFemale] });
                    } else {
                        await interaction.editReply({ content: i18next.t('verify-js_no_roles'), ephemeral: true });
                    }
                    break;

                default:
                    await interaction.editReply({ content: i18next.t('Error'), ephemeral: true });
            }
        } catch (error) {
            console.error(`Произошла ошибка: ${error.message}`);
            return await interaction.editReply({ content: `Произошла ошибка: ${error.message}`, ephemeral: true });
        }
    },
};
