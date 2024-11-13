// Импорт необходимых модулей и функций
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const { i18next, t } = require('../../i18n');
const { getAllActiveWarnings } = require('../../database/warningsDb');
const { formatDuration } = require('../../events');
const userCommandCooldowns = new Map();
module.exports = {
    data: new SlashCommandBuilder()
        .setName('warnlist')
        .setDescription(i18next.t('warnlist-js_description')),

    /**
         * @param {Client} robot - экземпляр Discord.js Client
         * @param {CommandInteraction} interaction - объектInteraction от Discord.js
         */
    async execute(robot, interaction) {
        if (interaction.user.bot) return;
        if (interaction.channel.type === ChannelType.DM) {
            return await interaction.reply({ content: i18next.t('error_private_messages'), ephemeral: true });
          }

        const commandCooldown = userCommandCooldowns.get(interaction.user.id);
        if (commandCooldown && commandCooldown.command === 'warnlist' && Date.now() < commandCooldown.endsAt) {
          const timeLeft = Math.round((commandCooldown.endsAt - Date.now()) / 1000);
          return interaction.reply({ content: (i18next.t(`cooldown`, { timeLeft: timeLeft})), ephemeral: true });
        }
        // Откладываем ответ на запрос, чтобы можно было отправить несколько сообщений
        await interaction.deferReply({ ephemeral: true });
        try {

            const { member, guild } = interaction;

            // Проверка, существует ли член гильдии и имеет ли он роли
            if (!member || !member.roles) {
                return interaction.editReply({ content: i18next.t('Error'), ephemeral: true });
            }

            // Проверка, имеет ли пользователь разрешение на модерирование членов
            if (!interaction.member.permissions.has('ModerateMembers')) {
                return interaction.editReply({ content: i18next.t('ModerateMembers_user_check'), ephemeral: true });
            }

            // Получение всех активных предупреждений для сервера
            const allActiveWarnings = await getAllActiveWarnings(guild.id);

            // Проверка, есть ли активные предупреждения
            if (allActiveWarnings.length === 0) {
                return interaction.editReply({ content: i18next.t('warnlist-js_no_active_warnings'), ephemeral: true });
            }

            const displayWarnings = async (page) => {
                const usersPerPage = 10;
                const start = (page - 1) * usersPerPage;
                const end = start + usersPerPage;
                const slicedWarnings = allActiveWarnings.slice(start, end);

                const embed = new EmbedBuilder()
                    .setTitle(i18next.t('warnlist-js_active_warnings_list', { server_name: guild.name }));

                // Проверка, есть ли предупреждения для отображения на этой странице
                if (slicedWarnings.length > 0) {
                    embed
                        .setDescription(
                            slicedWarnings.map((warning) => {
                                let warningInfo = `**<@${warning.userId}>**`;
                                warningInfo += ` - (${warning.reason})`;
                                warningInfo += ` - ${formatDuration(warning.duration - Date.now())}`;
                                return warningInfo;
                            }).join('\n')
                        )
                        .setFooter({
                            text: i18next.t(`warnlist-js_users_active`, { current_page: page, total_pages: Math.ceil(allActiveWarnings.length / usersPerPage) }),
                        });
                } else {
                    embed.setDescription(i18next.t('warnlist-js_no_users_to_display'));
                }

                const rows = [];

                // Добавление кнопки "Назад", если это не первая страница
                if (page > 1) {
                    rows.push(
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId(`warnlist-page-${page - 1}`)
                                .setLabel('⬅️')
                                .setStyle(ButtonStyle.Primary)
                        )
                    );
                }

                // Добавление кнопки "Вперед", если это не последняя страница
                if (end < allActiveWarnings.length) {
                    rows.push(
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId(`warnlist-page-${page + 1}`)
                                .setLabel('➡️')
                                .setStyle(ButtonStyle.Primary)
                        )
                    );
                }

                // Отредактирование сообщения с предупреждениями и кнопками
                await interaction.editReply({ embeds: [embed], components: rows, ephemeral: true });
            };

            // Отображение первой страницы предупреждений
            await displayWarnings(1);

            // Создание сборщика компонентов для обработки нажатий на кнопки
            const filter = (i) => i.user.id === interaction.user.id;
            const collector = interaction.channel.createMessageComponentCollector({ filter, time: 300000 });
            userCommandCooldowns.set(interaction.user.id, { command: 'warnlist', endsAt: Date.now() + 300200 });
            collector.on('collect', async (i) => {
                if (i.deferred || i.replied) return;
                if (i.customId.startsWith('warnlist-page-')) {
                    const page = parseInt(i.customId.split('-')[2]);
                    await i.update({ components: [] });
                    await new Promise(resolve => setTimeout(resolve, 100)); // добавляем задержку в 0.1 секунды
                    await displayWarnings(page);
                }
            });
        } catch (error) {
            console.error(`Произошла ошибка: ${error.message}`);
            return interaction.editReply({ content: i18next.t('Error'), ephemeral: true });
        }
        setTimeout(() => {
            userCommandCooldowns.delete(interaction.user.id);
          }, 300200);
    },
};