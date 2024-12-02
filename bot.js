// Загружаем переменные окружения
require('dotenv').config();

// Импортируем необходимые модули
const { Collection, ChannelType, REST, Routes, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const cron = require('node-cron');
const { initializeDefaultServerSettings, getServerSettings } = require('./database/settingsDb');
const { removeExpiredWarnings } = require('./database/warningsDb');
const { removeExpiredMutes } = require('./database/mutesDb');
const { initializeI18next, i18next } = require('./i18n');
const { createLogChannel, assignNewMemberRole, checkAntiRaidConditions } = require('./events');

// Инициализируем массивы для хранения черного списка и плохих ссылок
let blacklist = [];
let bad_links = [];

// Загружаем черный список и плохие ссылки из файлов
async function loadBlacklistAndBadLinks() {
  try {
    const [blacklistData, badLinksData] = await Promise.all([
      fs.promises.readFile('blacklist.txt', 'utf8'),
      fs.promises.readFile('bad_links.txt', 'utf8'),
    ]);

    blacklist = blacklistData.trim().split('\n').map((word) => word.trim());
    bad_links = badLinksData.trim().split('\n').map((link) => link.trim());

    console.log(`Загружено ${blacklist.length} слов в черный список.`);
    console.log(`Загружено ${bad_links.length} ссылок в плохие ссылки.`);
  } catch (err) {
    console.error('Ошибка при загрузке черного списка и плохих ссылок:', err);
  }
}

// Инициализируем локализацию для сервера
async function initializeLocalizationForServer(guildId) {
  try {
    const serverSettings = await getServerSettings(guildId);
    const serverLanguage = serverSettings.language || 'eng'; // Используем 'eng' по умолчанию
    await initializeI18next(serverLanguage);
  } catch (error) {
    console.error('Ошибка при инициализации локализации:', error);
  }
}

// Инициализируем переменные
const commands = [];
const guildsData = new Map();
const rest = new REST().setToken(process.env.TOKEN);

// Загружаем и регистрируем команды
(async () => {
  await initializeI18next('eng'); // Инициализация с языком по умолчанию

  try {
    // Создаем экземпляр клиента Discord
    const { Client, GatewayIntentBits, Partials } = require('discord.js');

    const robot = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMessageTyping,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildScheduledEvents
      ],
      partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction,
        Partials.User,
        Partials.GuildMember,
        Partials.GuildScheduledEvent
      ]
    });

    robot.commands = new Collection();
    const commandFolders = fs.readdirSync('./commands');

    for (const folder of commandFolders) {
      const commandFiles = fs.readdirSync(`./commands/${folder}`).filter((file) => file.endsWith('.js'));
      for (const file of commandFiles) {
        const command = require(`./commands/${folder}/${file}`);
        if ('data' in command && 'execute' in command) {
          robot.commands.set(command.data.name, command);
          commands.push(command.data.toJSON());
        } else {
          console.log(`Предупреждение! Команда по пути ./commands/${folder}/${file} потеряла свойство "data" или "execute".`);
        }
      }
    }

    // Регистрируем команды
    try {
      const data = await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commands },
      );

      console.log(`Успешно зарегистрировано ${data.length} команд.`);
    } catch (error) {
      console.error('Ошибка при регистрации команд:', error);
    }

    // Обработчики событий
    robot.on('guildCreate', async (guild) => {
      console.log(`Бот добавлен на сервер: ${guild.name}`);

      // Инициализируем настройки сервера по умолчанию
      await initializeDefaultServerSettings(guild.id);
      await new Promise((resolve) => setTimeout(resolve, 500)); // Задержка перед обновлением данных

      const defaultSettings = await getServerSettings(guild.id);
      guildsData.set(guild.id, defaultSettings);
      console.log(`Данные гильдии инициализированы для ID: ${guild.id}`);
    });

    robot.on('ready', async () => {
      console.log(`${robot.user.username} готов к работе`);
      const guilds = robot.guilds.cache;

      for (const guild of guilds.values()) {
        const guildId = guild.id;

        try {
          let serverSettings = await getServerSettings(guildId);
          if (!serverSettings || Object.keys(serverSettings).length === 0) {
            await initializeDefaultServerSettings(guildId);
            serverSettings = await getServerSettings(guildId);
          }

          await initializeLocalizationForServer(guildId);
          guildsData.set(guildId, serverSettings);
        } catch (error) {
          console.error(`Ошибка при обработке сервера ${guildId}:`, error);
        }
      }

      // Запускаем загрузку черного списка и плохих ссылок
      await loadBlacklistAndBadLinks();
    });

    robot.on('interactionCreate', async (interaction) => {
      if (!interaction.isCommand()) return;

      const command = robot.commands.get(interaction.commandName);
      if (!command) {
        await interaction.reply({ content: i18next.t('Error'), ephemeral: true });
        return;
      }

      try {
        let serverLanguage = 'eng';
        if (interaction.guild) {
          const guildId = interaction.guild.id;
          const serverSettings = await getServerSettings(guildId);
          serverLanguage = serverSettings.language || 'eng';
        }

        await initializeI18next(serverLanguage);
        console.log(`Выполнение команды: ${interaction.commandName}`);
        await command.execute(robot, interaction);
      } catch (error) {
        console.error('Ошибка при выполнении команды:', error);
        await interaction.reply({ content: i18next.t('Error'), ephemeral: true });
      }
    });

    // Событие при добавлении нового участника на сервер
    robot.on('guildMemberAdd', async (member) => {
      try {
        const serverSettings = await getServerSettings(member.guild.id);
        const { banRoleName, newMemberRoleName, logChannelName, banLogChannelName, banLogChannelNameUse } = serverSettings;

        // Проверяем условия анти-рейда
        await checkAntiRaidConditions(member, banRoleName, logChannelName, banLogChannelName, banLogChannelNameUse);
        await assignNewMemberRole(member, newMemberRoleName);
      } catch (error) {
        console.error(`Ошибка при обработке нового участника ${member.user.tag}: ${error.message}`);
      }
    });

    robot.on('messageCreate', async (message) => {
      if (!message.guild || message.author.bot) return;

      const serverSettings = await getServerSettings(message.guild.id);
      const {
        uniteAutomodBlacklists,
        uniteAutomodBadLinks,
        automod,
        automodBlacklist,
        automodBadLinks,
        logChannelName,
        NotAutomodChannels,
      } = serverSettings;

      if (!automod) return;

      const NotAutomodChannelsSet = new Set(NotAutomodChannels?.split(',') || []);
      if (NotAutomodChannelsSet.has(message.channel.name)) return;

      const botMember = await message.guild.members.fetch(robot.user.id);
      const authorMember = await message.guild.members.fetch(message.author.id);
      const mess_value = message.content.toLowerCase();

      if (botMember.roles.highest.position <= authorMember.roles.highest.position) return;

      let logChannel = message.guild.channels.cache.find((channel) => channel.name === logChannelName);
      if (!logChannel) {
        const channelNameToCreate = logChannelName;
        const higherRoles = [...message.guild.roles.cache.values()].filter((role) => botMember.roles.highest.position < role.position);
        const logChannelCreationResult = await createLogChannel(message, channelNameToCreate, botMember, higherRoles);

        if (logChannelCreationResult.startsWith('Ошибка')) {
          console.error(logChannelCreationResult);
          return;
        }

        logChannel = message.guild.channels.cache.find((ch) => ch.name === channelNameToCreate);
      }

      let blacklistToUse, bad_linksToUse;

      if (uniteAutomodBlacklists && automodBlacklist !== 'fuck') {
        blacklistToUse = [...new Set([...(automodBlacklist || '').split(','), ...blacklist])];
      } else {
        blacklistToUse = [...(automodBlacklist || '').split(',')];
      }

      if (uniteAutomodBadLinks && automodBadLinks !== 'azino777cashcazino-slots.ru') {
        bad_linksToUse = [...new Set([...(automodBadLinks || '').split(','), ...bad_links])];
      } else {
        bad_linksToUse = [...(automodBadLinks || '').split(',')];
      }

      // Проверяем черный список и плохие ссылки
      for (const item of [...blacklistToUse, ...bad_linksToUse]) {
        if (mess_value.includes(item)) {
          await message.delete();
          const embed = new EmbedBuilder()
            .setTitle(i18next.t('bot-js_delete_message'))
            .setDescription(i18next.t(`bot-js_delete_item_logchannel`, { mess_author: message.author.id, item: item }))
            .addFields(
              { name: i18next.t('bot-js_delete_message_value', { message_content: message.content }), value: '\u200B' },
              { name: i18next.t('bot-js_reason', { item: item }), value: `${item}` }
            )
            .setTimestamp();

          try {
            await logChannel.send({ embeds: [embed] });
          } catch (error) {
            console.error('Ошибка при отправке сообщения в канал журнала:', error);
          }

          try {
            await message.author.send(i18next.t('bot-js_delete_item_user', { item: item }));
          } catch (error) {
            console.error('Ошибка при отправке сообщения пользователю:', error);
          }

          return;
        }
      }

      // Проверка на наличие Discord-ссылок
      const discordLinkRegex = /(https?:\/\/)?(www\.)?(discord\.gg|discordapp\.com|discord\.com)\/[^\s]+/i;
      if (discordLinkRegex.test(mess_value)) {
        await message.delete();

        const embed = new EmbedBuilder()
          .setTitle(i18next.t('message_deleted'))
          .setDescription(i18next.t('another_channel_message', { author: message.author.id }))
          .addFields(
            { name: i18next.t('delete_message_content'), value: message.content, inline: false },
            { name: i18next.t('ban-js_reason'), value: i18next.t('delete_message_content_reason'), inline: false }
          )
          .setTimestamp();

        try {
          await logChannel.send({ embeds: [embed] });
        } catch (error) {
          console.error('Ошибка при отправке сообщения в канал журнала:', error);
        }

        try {
          await message.author.send(i18next.t('another_channel_user_message'));
        } catch (error) {
          console.error('Ошибка при отправке сообщения пользователю:', error);
        }
        return; // Добавляем return, чтобы не продолжать проверку
      }
    });

    function setupCronJobs(robot) {
      cron.schedule('*/2 * * * *', async () => {
        console.log('Запуск задачи по расписанию для проверки');

        try {
          // Проверяем, инициализирован ли объект robot и доступны ли guilds
          if (!robot || !robot.guilds) {
            console.log('Объект robot не инициализирован или guilds недоступны.');
            return;
          }

          // Проверяем, есть ли доступные гильдии
          if (robot.guilds.cache.size === 0) {
            console.log('Нет доступных серверов для обработки.');
            return;
          }

          for (const guild of robot.guilds.cache.values()) {


            try {

              // Получаем настройки сервера
              const serverSettings = await getServerSettings(guild.id);
              const { newMemberRoleName } = serverSettings;

              // Проверяем участников на наличие ролей и назначаем роль новичка
              const members = await guild.members.fetch();

              for (const [memberId, member] of members) {
                if (member.roles.cache.size === 0) {
                  await assignNewMemberRole(member, newMemberRoleName);
                  console.log(`Роль новичка назначена участнику ${member.user.tag} на сервере ${guild.name}`);
                }
              }

              // Удаление истекших предупреждений и мутов
              await removeExpiredWarnings(robot, guild.id, serverSettings);
              await removeExpiredMutes(robot, guild.id);

            } catch (error) {
              console.error(`Ошибка при обработке сервера ${guild.id}:`, error);
            }
          }
        } catch (error) {
          console.error(`Ошибка при запуске задачи cron:`, error);
        }
      });
    }


    setupCronJobs(robot);
    robot.login(process.env.TOKEN);
  } catch (error) {
    console.error('Ошибка при инициализации бота:', error);
  }
})
  ();
