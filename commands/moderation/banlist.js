// Импортируем необходимые классы и модули
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { i18next, t } = require('../../i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('banlist')
    .setDescription(i18next.t('banlist-js_description')),

  async execute(robot, interaction) {
    // Откладываем ответ, чтобы бот не блокировался во время выполнения команды
    await interaction.deferReply({ ephemeral: true });

    try {
      if (interaction.user.bot) return;
      if (interaction.channel.type === ChannelType.DM) {
        return interaction.editReply({ content: i18next.t('error_private_messages'), ephemeral: true });
      }

      // количество пользователей на одной странице и текущую страницу
      const usersPerPage = 10;
      let currentPage = 1;
      const { member, guild } = interaction;

      // является ли пользователь членом сервера и имеет ли он роли
      if (!member || !member.roles) {
        return interaction.editReply({ content: i18next.t('Error'), ephemeral: true });
      }

      // имеет ли пользователь право на бан других пользователей
      if (!member.roles.cache.some(role => role.permissions.has(PermissionsBitField.Flags.BanMembers))) {
        return interaction.editReply({ content: i18next.t('BanMembers_user_check'), ephemeral: true });
      }

      // список забаненных пользователей
      const banlistUsers = await guild.bans.fetch().catch(() => {
        if (!interaction.deferred && !interaction.replied) {
          interaction.reply({ content: i18next.t('banlist-js_error_fetching_banlist'), ephemeral: true });
        } else {
          interaction.editReply({ content: i18next.t('banlist-js_error_fetching_banlist'), ephemeral: true });
        }
        throw new Error('Failed to fetch banlist');
      });

      if (banlistUsers.size === 0) {
        interaction.editReply({ content: i18next.t('banlist-js_no_banned_users'), ephemeral: true });
        return;
      }

      // общее количество страниц и нужно ли отображать пагинацию
      const totalPages = Math.ceil(banlistUsers.size / usersPerPage);
      const shouldDisplayPagination = totalPages > 1;

      // Функция для отображения списка забаненных пользователей на указанной странице
      const displayBanlist = async (page) => {
        currentPage = page;
        const start = (page - 1) * usersPerPage;
        const end = start + usersPerPage;
        const slicedUsers = [...banlistUsers.values()].slice(start, end);

        const embed = new EmbedBuilder()
          .setTitle(i18next.t('banlist-js_banned_users_list', { server_name: guild.name }));

        if (slicedUsers.length > 0) {
          embed
            .setDescription(slicedUsers.map(ban => `**<@${ban.user.id}>** - ${ban.reason || i18next.t('defaultReason')}`).join('\n'))
            .setFooter({ text: i18next.t(`banlist-js_users_banned`, { current_page: page, total_pages: totalPages }) });
        } else {
          embed.setDescription(i18next.t('banlist-js_no_users_to_display'));
        }

        const rows = [];

        if (shouldDisplayPagination) {
          if (page > 1) {
            rows.push(
              new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(`banlist-page-${page - 1}`)
                  .setLabel('⬅️')
                  .setStyle(ButtonStyle.Primary)
              )
            );
          }

          if (end < banlistUsers.size) {
            rows.push(
              new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(`banlist-page-${page + 1}`)
                  .setLabel('➡️')
                  .setStyle(ButtonStyle.Primary)
              )
            );
          }
        }

        await interaction.editReply({ embeds: [embed], components: rows, ephemeral: true });
      };

      // Если пагинация не нужна, отображаем список забаненных пользователей на первой странице
      if (!shouldDisplayPagination) {
        const slicedUsers = [...banlistUsers.values()].slice(0, usersPerPage);
        const embed = new EmbedBuilder()
          .setTitle(i18next.t('banlist-js_banned_users_list', { server_name: guild.name }))
          .setDescription(slicedUsers.map(ban => `**<@${ban.user.id}>** - ${ban.reason || i18next.t('defaultReason')}`).join('\n'))
          .setFooter({ text: i18next.t(`banlist-js_users_banned`, { current_page: 1, total_pages: totalPages }) });

        await interaction.editReply({ embeds: [embed], ephemeral: true });
      } else {
        // Если пагинация нужна, отображаем список забаненных пользователей на текущей странице
        await displayBanlist(currentPage);
      }

      // Создаем сборщик сообщений
      const filter = (i) => i.user.id === interaction.user.id;
      const collector = interaction.channel.createMessageComponentCollector({ filter, time: 300000 });

      // Обработка кликов по кнопкам пагинации
      collector.on('collect', async (i) => {
        if (i.deferred || i.replied) return;
        if (i.customId.startsWith('banlist-page-')) {
          const page = parseInt(i.customId.split('-')[2]);
          await i.update({ components: [] });
          await new Promise(resolve => setTimeout(resolve, 100));
          await displayBanlist(page, currentPage);
        }
      });
    } catch (error) {
      console.error(`Произошла ошибка: ${error.message}`);
      return interaction.editReply({ content: i18next.t('Error'), ephemeral: true });
    }
  },
};