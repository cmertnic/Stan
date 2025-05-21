// Импорт необходимых модулей и функций
const { ChannelType, SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { initializeDefaultServerSettings, getServerSettings } = require('../../database/settingsDb');
const { i18next } = require('../../i18n');
const { handleButtonInteraction, displaySettings } = require('../../events');
const userCommandCooldowns = new Map();

// Экспортируем объект команды
module.exports = {
    data: new SlashCommandBuilder()
        .setName('settings')
        .setDescription(i18next.t('settings-js_description')),
    async execute(robot, interaction) {
        if (interaction.user.bot) return;
        if (interaction.channel.type === ChannelType.DM) {
            return await interaction.reply({ content: i18next.t('error_private_messages'), flags: 64 });
        }

        const commandCooldown = userCommandCooldowns.get(interaction.user.id);
        if (commandCooldown && commandCooldown.command === 'settings' && Date.now() < commandCooldown.endsAt) {
            const timeLeft = Math.round((commandCooldown.endsAt - Date.now()) / 1000);
            return interaction.reply({ content: (i18next.t(`cooldown`, { timeLeft: timeLeft })), flags: 64 });
        }

        const guildId = interaction.guild.id;

        // Проверка прав администратора у пользователя, вызвавшего команду
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return await interaction.reply({ content: i18next.t('Admin_user_check'), flags: 64 });
        }

        userCommandCooldowns.set(interaction.user.id, { command: 'settings', endsAt: Date.now() + 300200 });

        try {
            // Отложите ответ, если нужна дополнительная обработка
            await interaction.deferReply({ flags: 64 });

            // Получение настроек сервера или создание настроек по умолчанию, если их нет
            const config = await getServerSettings(guildId) || await initializeDefaultServerSettings(guildId);
            // Отправка уведомления о загрузке настроек
            await interaction.editReply({ content: (i18next.t('settings-js_load')), flags: 64 });
            // Отображение настроек
            await displaySettings(interaction, config);

            // Создание коллектора сообщений для обработки кнопок
            const filter = (i) => i.user.id === interaction.user.id && !i.customId.startsWith('help_') && !i.customId.startsWith('language_'); // Игнорируем customId, начинающийся с help_ и language_
            const collector = interaction.channel.createMessageComponentCollector({ filter, time: 300000 });

            // Обработка нажатых кнопок
            collector.on('collect', async (i) => {
                if (i.deferred || i.replied) return;
                const page = parseInt(i.message.embeds[0]?.footer?.text?.match(/\d+/)?.[0]) || 1;
                await handleButtonInteraction(i, config, page);
            });
        } catch (error) {
            console.error(`Произошла ошибка: ${error.message}`);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: i18next.t('Error'), flags: 64 });
            } else {
                await interaction.editReply({ content: i18next.t('Error'), flags: 64 });
            }
        }

        setTimeout(() => {
            userCommandCooldowns.delete(interaction.user.id);
        }, 300200);
    }
};
