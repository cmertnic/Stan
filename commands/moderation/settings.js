// Импорт необходимых модулей и функций
const { ChannelType, SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { initializeDefaultServerSettings, getServerSettings } = require('../../database/settingsDb');
const { i18next, t } = require('../../i18n');
const { handleButtonInteraction, displaySettings } = require('../../events');

// Экспортируем объект команды
module.exports = {
    data: new SlashCommandBuilder()
        .setName('settings')
        .setDescription(i18next.t('settings-js_description')),
    async execute(robot, interaction) {
        if (interaction.user.bot) return;
        if (interaction.channel.type === ChannelType.DM) {
            interaction.reply({ content: i18next.t('error_private_messages'), ephemeral: true });
            return;
        }
        const guildId = interaction.guild.id;
        // Проверка прав администратора у пользователя, вызвавшего команду
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            interaction.reply({ content: i18next.t('Admin_user_check'), ephemeral: true });
            return;
        }
        try {
            // Получение настроек сервера или создание настроек по умолчанию, если их нет
            const config = await getServerSettings(guildId) || await initializeDefaultServerSettings(guildId);
            // Отправка уведомления о загрузке настроек
            await interaction.reply({ content: (i18next.t('settings-js_load')), ephemeral: true });
            // Отображение настроек
            await displaySettings(interaction, config);

            // Создание коллектора сообщений для обработки кнопок
            const filter = (i) => i.user.id === interaction.user.id;
            const collector = interaction.channel.createMessageComponentCollector({ filter, time: 300000 });
            // Обработка нажатых кнопок
            collector.on('collect', async (i) => {
                if (i.deferred || i.replied) return;
                const page = parseInt(i.message.embeds[0]?.footer?.text?.match(/\d+/)?.[0]) || 1;
                await handleButtonInteraction(i, config, page);
                await i.editReply({ content: (i18next.t('settings-js_load')), ephemeral: true });
            });
        }catch (error) {
            console.error(`Произошла ошибка: ${error.message}`);
            return interaction.editReply({ content: i18next.t('Error'), ephemeral: true });
        }
    }
};
