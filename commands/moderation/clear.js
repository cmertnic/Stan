// Импортируем необходимые классы и модули
require('dotenv').config();
const { Client, DiscordAPIError, CommandInteraction, ChannelType, EmbedBuilder, MessageFlags } = require('discord.js');
const { getPlural, createLogChannel } = require('../../events');
const { getServerSettings } = require('../../database/settingsDb');
const { SlashCommandBuilder } = require('@discordjs/builders');
const { i18next, t } = require('../../i18n');
const AMOUNT_OPTION_NAME = (i18next.t('clear-js_amount'));

// Объект для отслеживания состояния выполнения функции для каждого сервера
const isClearing = {};
module.exports = {
    data: new SlashCommandBuilder()
        .setName('clear')
        .setDescription(i18next.t('clear-js_description'))
        .addStringOption(option =>
            option.setName(AMOUNT_OPTION_NAME)
                .setDescription(i18next.t('clear-js_amount_description'))
                .setRequired(true)),
    /**
     * Выполнение команды
     * @param {Client} robot - экземпляр клиента Discord.js
     * @param {CommandInteraction} interaction - объект взаимодействия с пользователем
     */
    async execute(robot, interaction) { 
        if (interaction.user.bot) return;
        if (interaction.channel.type === ChannelType.DM) {
            return await interaction.reply({ content: i18next.t('error_private_messages'), ephemeral: true });
          }
        // Откладываем ответ, чтобы бот не блокировался во время выполнения команды
        await interaction.deferReply({ ephemeral: true });
        const guild = interaction.guild;
        // Предварительные проверки

        // Проверка прав пользователя
        const member = interaction.member;
        if (member && !member.permissions.has('ModerateMembers')) {
            await interaction.editReply({ content: i18next.t('ModerateMembers_user_check'), ephemeral: true });
            isClearing[interaction.guild.id] = false;
            return;
        }

        const amountString = interaction.options.getString(AMOUNT_OPTION_NAME);
        const amount = parseInt(amountString, 10);
        if (!amount || isNaN(amount) || amount < 1) {
            await interaction.editReply({ content: i18next.t('clear-js_amount_to_delete'), ephemeral: true });
            isClearing[interaction.guild.id] = false;
            return;
        }
        // Предварительные проверки
        if (interaction.user.bot || !interaction.guild || isClearing[interaction.guild.id]) return;

        // Устанавливаем флаг выполнения для конкретного сервера
        isClearing[interaction.guild.id] = true;
        // Получение настроек сервера
        const serverSettings = await getServerSettings(interaction.guild.id);
        const logChannelName = serverSettings.logChannelName;
        const clearNotice = serverSettings.clearNotice;
        const clearLogChannelName = serverSettings.clearLogChannelName;
        const clearLogChannelNameUse = serverSettings.clearLogChannelNameUse;

        // Переменная для подсчета количества удаленных сообщений
        let deletedCount = 0;
        try {
            // Получение участника бота
            const botMember = await interaction.guild.members.fetch(interaction.client.user.id);
            if (!botMember) {
                return interaction.editReply({ content: i18next.t('error_bot_member'), ephemeral: true });
            }

            // Проверка наличия полномочий у бота для управления сообщениями
            if (!botMember.permissions.has('ModerateMembers')) {
                await interaction.reply({ content: i18next.t('ModerateMembers_bot_check'), ephemeral: true });
                isClearing[interaction.guild.id] = false;
                return;
            }

            let skippedCount = 0; // Счетчик пропущенных сообщений
            while (deletedCount < amount) {
                try {
                    const fetched = await interaction.channel.messages.fetch({ limit: Math.min(amount - deletedCount, 100) });
                    const now = Date.now();
                    const twoWeeksAgo = now - 1209600000; // Две недели в миллисекундах

                    // Фильтрация сообщений, которые можно удалить (не эфемерные)
                    const deletable = fetched.filter(m => m.createdTimestamp > twoWeeksAgo && !(m.flags & MessageFlags.EPHEMERAL));
                    if (deletable.size > 0) {
                        const deleted = await interaction.channel.bulkDelete(deletable, true).catch(e => e);
                        deletedCount += deleted.size;
                    } else {
                        // Если нет сообщений для удаления, отправляем уведомление и прерываем цикл
                        await interaction.editReply({ content: i18next.t('error_not_found_new_messages'), ephemeral: true });
                        break;
                    }

                    // Подсчет пропущенных сообщений старше 14 дней
                    skippedCount += fetched.size - deletable.size;
                    if (fetched.size < 100 || deletedCount >= amount) {
                        // Если получено меньше 100 сообщений или достигнуто желаемое количество, значит достигнут конец канала или выполнена задача
                        break;
                    }
                } catch (error) {
                    console.error('Произошла ошибка при удалении сообщений:', error);
                    await interaction.editReply({ content: i18next.t('Error'), ephemeral: true });
                    break;
                }
            }

            // Логирование результатов
            if (deletedCount > 0 || skippedCount > 0) {
                const deletedWord = getPlural(deletedCount, i18next.t('clear-js_deletedWord_1'), i18next.t('clear-js_deletedWord_2'), i18next.t('clear-js_deletedWord_3'));
                const skippedWord = getPlural(skippedCount, i18next.t('clear-js_skippedWord_1'), i18next.t('clear-js_skippedWord_2'), i18next.t('clear-js_skippedWord_3'));

                // Проверка наличия канала логирования
                let logChannel;
                if (clearLogChannelNameUse) {
                    logChannel = guild.channels.cache.find(ch => ch.name === clearLogChannelName);
                } else {
                    logChannel = guild.channels.cache.find(ch => ch.name === logChannelName);
                }

                if (!logChannel) {
                    const channelNameToCreate = clearLogChannelNameUse ? clearLogChannelName : logChannelName;
                    const roles = interaction.guild.roles.cache;
                    const higherRoles = roles.filter(role => botMember.roles.highest.comparePositionTo(role) < 0);
                    const logChannelCreationResult = await createLogChannel(interaction, channelNameToCreate, botMember, higherRoles, serverSettings);

                    if (logChannelCreationResult.startsWith('Ошибка')) {
                        await interaction.followUp({ content: logChannelCreationResult, ephemeral: true });
                    }

                    // Переопределяем переменную logChannel, так как она теперь может содержать новый канал
                    logChannel = guild.channels.cache.find(ch => ch.name === channelNameToCreate);
                }

                if (clearNotice) {
                    const EmbedDeletedWords = new EmbedBuilder()
                        .setColor(0x00FF00)
                        .setTitle(i18next.t('clear-js_deletedWords_channel_title'))
                        .setDescription(
                            i18next.t('clear-js_deletedWords_channel', {
                                userId: interaction.member.user.id,
                                deletedCount: deletedCount,
                                deletedWord: deletedWord,
                                skippedCount: skippedCount,
                                skippedWord: skippedWord,
                                channelId: interaction.channel.id,
                            })
                        )
                        .setTimestamp()
                        .setFooter({ text: i18next.t('clear-js_deletedWords_channel_footer', { moderator: interaction.user.tag }) });

                    await logChannel.send({ embeds: [EmbedDeletedWords] });
                }
            }

            // Отправка сообщения о завершении очистки
            await interaction.editReply({ content: i18next.t('clear-js_deletedWords_moderator'), ephemeral: true });

            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.editReply({ content: i18next.t('clear-js_deletedWords_moderator'), ephemeral: true });
                }
            } catch (error) {
                console.error('Error sending reply:', error);
            }

        } catch (error) {
            console.error('Произошла ошибка при удалении сообщений:', error);
            let errorMessage = i18next.t('error_not_delete_messages');
            if (error instanceof DiscordAPIError && error.code === 10008) {
                errorMessage = i18next.t('error_not_found_messages_to_delete');
            }
            await interaction.editReply({ content: errorMessage, ephemeral: true });
        } finally {
            isClearing[interaction.guild.id] = false;
        }
    }
};