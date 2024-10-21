// Загружаем переменные окружения
require('dotenv').config();

// Импортируем необходимые модули
const { Client, Collection, GatewayIntentBits, Partials, REST, Routes, EmbedBuilder, } = require('discord.js');
const fs = require('fs');
const cron = require('node-cron');
const { initializeDefaultServerSettings, getServerSettings, } = require('./database/settingsDb');
const { getAllMemberIds, updateMembersInfo } = require('./database/membersDb');
const { removeExpiredWarnings } = require('./database/warningsDb');
const { removeExpiredMutes } = require('./database/mutesDb');
const { initializeI18next, i18next, t } = require('./i18n');
const { createLogChannel } = require('./events');
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
    const serverLanguage = serverSettings.language;
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
  await initializeI18next('eng');
  try {
    // Создаем экземпляр клиента Discord
    const robot = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
      ],
      partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction,
        Partials.User,
      ],
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

      // Устанавливаем небольшую задержку перед обновлением данных гильдии
      await new Promise((resolve) => setTimeout(resolve, 500));

      const defaultSettings = await getServerSettings(guild.id);
      // Сохраняем данные гильдии в Map
      guildsData.set(guild.id, defaultSettings);
      console.log(`Данные гильдии инициализированы для ID: ${guild.id}`);
    });

    robot.on('ready', async () => {
      console.log(`${robot.user.username} готов вкалывать`);
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

      try {
        await rest.put(
          Routes.applicationCommands(robot.user.id),
          { body: commands },
        );

      } catch (error) {
        console.error('Ошибка при регистрации команд:', error);
      }
    });

    robot.on('interactionCreate', async (interaction) => {
      if (!interaction.isCommand()) return;

      const command = robot.commands.get(interaction.commandName);

      if (!command) {
        await interaction.reply({ content: 'Команда не найдена!', ephemeral: true });
        return;
      }

      try {
        let serverLanguage = 'eng';

        if (interaction.guild) {
          // Получаем настройки сервера для языка
          const guildId = interaction.guild.id;
          const serverSettings = await getServerSettings(guildId);
          serverLanguage = serverSettings.language || 'rus';
        }

        // Обновляем язык для команды
        await initializeI18next(serverLanguage);

        console.log(`Выполнение команды: ${interaction.commandName}`);
        await command.execute(robot, interaction);
      } catch (error) {
        console.error('Ошибка при выполнении команды:', error);
        await interaction.reply({ content: 'Произошла ошибка при выполнении команды!', ephemeral: true });
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
            .setDescription(i18next.t(`bot-js_delete_${item_type}_logchanel`, { mess_author: message.author.id, item_type: item_type }))
            .addFields(
              { name: i18next.t('bot-js_delete_message_value', { message_content: message.content }), value: '\u200B' },
              { name: i18next.t(`bot-js_reason_${item_type}`, { item: item }), value: `${item}` }
            )
            .setTimestamp();

          try {
            await logChannel.send({ embeds: [embed] });
          } catch (error) {
            console.error('Ошибка при отправке сообщения в канал журнала:', error);
          }

          try {
            await message.author.send(i18next.t(`bot-js_delete_${item_type}_user`, { item: item }));
          } catch (error) {
            console.error('Ошибка при отправке сообщения пользователю:', error);
          }

          return;
        }
      }
    });


    function setupCronJobs() {
      cron.schedule('*/2 * * * *', async () => {
        console.log('Запуск задачи по расписанию для удаления истекших предупреждений и мутов.');
        for (const guild of robot.guilds.cache.values()) {
          const guildId = guild.id;
          try {
            // Получаем настройки сервера
            const serverSettings = await getServerSettings(guildId);

            // Получаем ID всех участников
            const memberIds = await getAllMemberIds(guild);

            // Обновляем информацию об участниках
            await updateMembersInfo(robot, guildId, memberIds);

            // Удаление истекших предупреждений и мутов
            await removeExpiredWarnings(robot, guildId, serverSettings, memberIds);
            await removeExpiredMutes(robot, guildId);
          } catch (error) {
            console.error(`Ошибка при обработке сервера ${guildId}:`, error);
          }
        }
      });
    }

    setupCronJobs();
    robot.login(process.env.TOKEN);
    loadBlacklistAndBadLinks();
  } catch (error) {
    console.error('Произошла непредвиденная ошибка:', error);
    console.error('Перезапуск бота...');

    // Перезапуск бота
    setTimeout(() => {
      require('child_process').exec('npm run start', (error, stdout, stderr) => {
        if (error) {
          console.error('Ошибка при перезапуске бота:', error);
        } else {
          console.log('Бот успешно перезапущен.');
        }
      });
    }, 2000); // Ждем 2 секунды перед перезапуском бота, чтобы избежать бесконечного цикла
  }
})();