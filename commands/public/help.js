// Подключаем необходимые модули
const { Client, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { SlashCommandBuilder } = require('@discordjs/builders');
const { i18next } = require('../../i18n');
const userCommandCooldowns = new Map();

// Экспортируем объект с данными и исполнением команды
module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription(i18next.t('help-js_description')),

    async execute(robot, interaction) {
        // Проверка, что пользователь не бот
        if (interaction.user.bot) return;

        const commandCooldown = userCommandCooldowns.get(interaction.user.id);
        if (commandCooldown && commandCooldown.command === 'help' && Date.now() < commandCooldown.endsAt) {
            const timeLeft = Math.round((commandCooldown.endsAt - Date.now()) / 1000);
            return interaction.reply({ content: (i18next.t(`cooldown`, { timeLeft: timeLeft })), ephemeral: true });
        }

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

        // Создаем embed для страницы команд общего назначения
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
                { name: (i18next.t(`help-js_Commands_for_moderators_page_name_13`)), value: (i18next.t(`help-js_Commands_for_moderators_page_value_13`)) },
                { name: (i18next.t(`help-js_Commands_for_moderators_page_name_14`)), value: (i18next.t(`help-js_Commands_for_moderators_page_value_14`)) }
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

        // Создаем кнопки для пагинации с customId, начинающимися с help_
        const row = new ActionRowBuilder()
            .addComponents([
                new ButtonBuilder()
                    .setCustomId('help_community')
                    .setLabel('👩‍👧‍👧')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('help_moderation')
                    .setLabel('🛡️')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('help_extra')
                    .setLabel('📒')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('help_rollback')
                    .setLabel('🏠')
                    .setStyle(ButtonStyle.Danger)
            ]);

        // Отправляем главное embed с кнопками
        await interaction.reply({ embeds: [mainEmbed], components: [row], ephemeral: true });

        // Устанавливаем кулдаун для команды
        userCommandCooldowns.set(interaction.user.id, { command: 'help', endsAt: Date.now() + 300200 });

        // Обработчик нажатий на кнопки
        const filter = (i) => i.user.id === interaction.user.id && i.customId.startsWith('help_'); // Фильтр для кнопок help
        const collector = interaction.channel.createMessageComponentCollector({ filter, time: 300000 });

        collector.on('collect', async (i) => {
            try {
                if (i.customId === 'help_community') {
                    await i.update({ embeds: [communityEmbed], components: [row] });
                } else if (i.customId === 'help_moderation') {
                    await i.update({ embeds: [moderationEmbed], components: [row] });
                } else if (i.customId === 'help_extra') {
                    await i.update({ embeds: [extraPageEmbed], components: [row] });
                } else if (i.customId === 'help_rollback') {
                    await i.update({ embeds: [mainEmbed], components: [row] });
                }
            } catch (error) {
                console.error('Error updating interaction:', error);
            }
        });

        collector.on('end', () => {
            userCommandCooldowns.delete(interaction.user.id);
        });

        setTimeout(() => {
            userCommandCooldowns.delete(interaction.user.id);
        }, 300200);
    }
};
