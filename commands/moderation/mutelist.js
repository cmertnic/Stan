// Импорт необходимых модулей и функций
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const { i18next, t } = require('../../i18n');
const { getAllActiveMutes } = require('../../database/mutesDb');
const { formatDuration } = require('../../events');
const userCommandCooldowns = new Map();
module.exports = {
  data: new SlashCommandBuilder()
    .setName('mutelist')
    .setDescription(i18next.t('mutelist-js_description')),

  /**
   * Обработчик команды
   * @param {import("discord.js").Client} robot - бот Discord
   * @param {import("discord.js").CommandInteraction} interaction - объект взаимодействия с ботом
   */
  async execute(robot, interaction) {
    const commandCooldown = userCommandCooldowns.get(interaction.user.id);
    if (commandCooldown && commandCooldown.command === 'mutelist' && Date.now() < commandCooldown.endsAt) {
      const timeLeft = Math.round((commandCooldown.endsAt - Date.now()) / 1000);
      return interaction.reply({ content: (i18next.t(`cooldown`, { timeLeft: timeLeft})), ephemeral: true });
    }
    try {
      // Проверка, что пользователь не бот
      if (interaction.user.bot) return;
      if (interaction.channel.type === ChannelType.DM) {
        return await interaction.editReply({ content: i18next.t('error_private_messages'), ephemeral: true });
      }

      const { member, guild } = interaction;

      // Проверка, что пользователь является членом сервера и имеет роли
      if (!member || !member.roles) {
        return interaction.editReply({ content: i18next.t('Error'), ephemeral: true });
      }

      // Проверка, что пользователь имеет права модерирования
      if (!interaction.member.permissions.has('ModerateMembers')) {
        await interaction.reply({ content: i18next.t('ModerateMembers_user_check'), ephemeral: true });
        return;
      }

      // Получение активных мутов
      const mutes = await getAllActiveMutes(guild.id);

      // Проверка, что есть активные муты
      if (mutes.length === 0) {
        interaction.editReply({ content: i18next.t('mutelist-js_no_active_mutes'), ephemeral: true });
        return;
      }

      const displayMutes = async (page) => {
        const usersPerPage = 10; // Количество пользователей на одной странице
        const start = (page - 1) * usersPerPage;
        const end = start + usersPerPage;
        const slicedMutes = mutes.slice(start, end);

        const embed = new EmbedBuilder()
          .setTitle(i18next.t('mutelist-js_active_mutes_list', { server_name: guild.name }));

        // описание для embed
        if (slicedMutes.length > 0) {
          embed
            .setDescription(
              slicedMutes.map((mute) => {
                let muteInfo = `**<@${mute.userId}>**`;
                muteInfo += ` - (${mute.reason})`;
                muteInfo += ` - ${formatDuration(mute.duration - Date.now())}`;
                return muteInfo;
              }).join('\n')
            )
            .setFooter({
              text: i18next.t(`mutelist-js_users_muted`, { current_page: page, total_pages: Math.ceil(mutes.length / usersPerPage) }),
            });
        } else {
          embed.setDescription(i18next.t('mutelist-js_no_users_to_display'));
        }

        const rows = [];

        // кнопки для переключения страниц
        if (page > 1) {
          rows.push(
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`mutelist-page-${page - 1}`)
                .setLabel('⬅️')
                .setStyle(ButtonStyle.Primary)
            )
          );
        }

        if (end < mutes.length) {
          rows.push(
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`mutelist-page-${page + 1}`)
                .setLabel('➡️')
                .setStyle(ButtonStyle.Primary)
            )
          );
        }

        // Отправка embed с кнопками
        await interaction.editReply({ embeds: [embed], components: rows, ephemeral: true });
      };

      // Отображение первой страницы мутов
      await displayMutes(1);

      // сборщик сообщений с компонентами для переключения страниц
      const filter = (i) => i.user.id === interaction.user.id;
      const collector = interaction.channel.createMessageComponentCollector({ filter, time: 300000 });

      // Обработчик нажатия кнопок
      userCommandCooldowns.set(interaction.user.id, { command: 'mutelist', endsAt: Date.now() + 300200 });
      collector.on('collect', async (i) => {
        if (i.deferred || i.replied) return;
        if (i.customId.startsWith('mutelist-page-')) {
          const page = parseInt(i.customId.split('-')[2]);
          await i.update({ components: [] });
          await new Promise(resolve => setTimeout(resolve, 100)); // задержка в 0.1 секунды между переключением страниц
          await displayMutes(page);
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