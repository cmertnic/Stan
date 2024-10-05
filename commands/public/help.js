// Подключаем необходимые модули
const { Client, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { SlashCommandBuilder } = require('@discordjs/builders');
const { i18next, t } = require('../../i18n');

// Экспортируем объект с данными и исполнением команды
module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription(i18next.t('help-js_description')),

    /**
     * @param {Client} robot - экземпляр клиента Discord.js
     * @param {CommandInteraction} interaction - объект interaction от Discord.js
     */
    async execute(robot, interaction) {
        // Проверка, что пользователь не бот
        if (interaction.user.bot) return;

        // Создаем embed для главной страницы помощи
        const mainEmbed = new EmbedBuilder()
            .setColor('White')
            .setTitle(i18next.t('help-js_main_page_title'))
            .setDescription(i18next.t('help-js_main_page_description'))
            .addFields(
                { name: i18next.t('help-js_main_page_name_1'), value: i18next.t('help-js_main_page_value_1') },
                { name: i18next.t('help-js_main_page_name_2'), value: i18next.t('help-js_main_page_value_2') },
                { name: i18next.t('help-js_main_page_name_3'), value: i18next.t('help-js_main_page_value_3') }
            );

        // Создаем embed для страницы команд общиго назначения
        const communityEmbed = new EmbedBuilder()
            .setColor('Green')
            .setTitle(i18next.t('help-js_General_commands_page_title'))
            .addFields(
                { name: i18next.t(`help-js_General_commands_page_name_1`), value: i18next.t(`help-js_General_commands_page_value_1`) },
                { name: i18next.t(`help-js_General_commands_page_name_2`), value: i18next.t(`help-js_General_commands_page_value_2`) }
            );

        // Создаем embed для страницы команд модераторов
        const moderationEmbed = new EmbedBuilder()
            .setColor('Blue')
            .setTitle(i18next.t('help-js_Commands_for_moderators_page_title'))
            .addFields([
                { name: (i18next.t(`help-js_Commands_for_moderators_page_name_1`)), value: (i18next.t(`help-js_Commands_for_moderators_page_value_1`)) },
                { name: (i18next.t(`help-js_Commands_for_moderators_page_name_2`)), value: (i18next.t(`help-js_Commands_for_moderators_page_value_2`)) },
                { name: (i18next.t(`help-js_Commands_for_moderators_page_name_3`)), value: (i18next.t(`help-js_Commands_for_moderators_page_value_3`)) },
                { name: (i18next.t(`help-js_Commands_for_moderators_page_name_4`)), value: (i18next.t(`help-js_Commands_for_moderators_page_value_4`)) },
                { name: (i18next.t(`help-js_Commands_for_moderators_page_name_5`)), value: (i18next.t(`help-js_Commands_for_moderators_page_value_5`)) },
                { name: (i18next.t(`help-js_Commands_for_moderators_page_name_6`)), value: (i18next.t(`help-js_Commands_for_moderators_page_value_6`)) },
                { name: (i18next.t(`help-js_Commands_for_moderators_page_name_7`)), value: (i18next.t(`help-js_Commands_for_moderators_page_value_7`)) },
                { name: (i18next.t(`help-js_Commands_for_moderators_page_name_8`)), value: (i18next.t(`help-js_Commands_for_moderators_page_value_8`)) },
                { name: (i18next.t(`help-js_Commands_for_moderators_page_name_9`)), value: (i18next.t(`help-js_Commands_for_moderators_page_value_9`)) },
                { name: (i18next.t(`help-js_Commands_for_moderators_page_name_10`)), value: (i18next.t(`help-js_Commands_for_moderators_page_value_10`)) },
                { name: (i18next.t(`help-js_Commands_for_moderators_page_name_11`)), value: (i18next.t(`help-js_Commands_for_moderators_page_value_11`)) },
                { name: (i18next.t(`help-js_Commands_for_moderators_page_name_12`)), value: (i18next.t(`help-js_Commands_for_moderators_page_value_12`)) },
                { name: (i18next.t(`help-js_Commands_for_moderators_page_name_13`)), value: (i18next.t(`help-js_Commands_for_moderators_page_value_13`)) }
            ]);

        // Создаем embed для страницы дополнительных команд
        const extraPageEmbed = new EmbedBuilder()
            .setColor('Yellow')
            .setTitle(i18next.t('help-js_extra_page_title'))
            .addFields([
                { name: (i18next.t(`help-js_extra_page_name_1`)), value: (i18next.t(`help-js_extra_page_value_1`)) },
                { name: (i18next.t(`help-js_extra_page_name_2`)), value: (i18next.t(`help-js_extra_page_value_2`)) },
                { name: (i18next.t(`help-js_extra_page_name_3`)), value: (i18next.t(`help-js_extra_page_value_3`)) },
                { name: (i18next.t(`help-js_extra_page_name_4`)), value: (i18next.t(`help-js_extra_page_value_4`)) },
            ]);

        // Создаем кнопки для пагинации
        const row = new ActionRowBuilder()
            .addComponents([
                new ButtonBuilder()
                    .setCustomId('community')
                    .setLabel('👩‍👧‍👧')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('moderation')
                    .setLabel('🛡️')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('extra')
                    .setLabel('📒')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('rollback')
                    .setLabel('🏠')
                    .setStyle(ButtonStyle.Danger)
            ]);

        // Отправляем главное embed с кнопками
        await interaction.reply({ embeds: [mainEmbed], components: [row], ephemeral: true });

        // Обработчик нажатий на кнопки
        const filter = (i) => i.user.id === interaction.user.id;
        const collector = interaction.channel.createMessageComponentCollector({ filter, time: 300000 });

        async function rollback(i) {
            await i.update({ embeds: [mainEmbed], components: [row] });
        }

        collector.on('collect', async (i) => {
            if (i.customId === 'community') {
                await i.update({ embeds: [communityEmbed], components: [row] });
            } else if (i.customId === 'moderation') {
                await i.update({ embeds: [moderationEmbed], components: [row] });
            } else if (i.customId === 'extra') {
                await i.update({ embeds: [extraPageEmbed], components: [row] });
            } else if (i.customId === 'rollback') {
                await rollback(i);
            }
        });
    }
};