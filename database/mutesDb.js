// Подключаем переменные окружения
require('dotenv').config();

// Импортируем необходимые библиотеки и модули
const { PermissionsBitField } = require('discord.js');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { getServerSettings } = require('../database/settingsDb');
const { createLogChannel } = require('../events');
const { i18next, t } = require('../i18n');

// Получаем полный путь к файлу базы данных мутов
const mutesDbPath = path.resolve(process.env.SQLITE_MUTES_DB_PATH);

// Создаем подключение к базе данных мутов
const mutesDb = new sqlite3.Database(mutesDbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error(err.message);
    } else {
        console.log('Подключено к базе данных мутов.');
    }
});

// Создаем таблицу мутов, если она ещё не существует
mutesDb.run(`CREATE TABLE IF NOT EXISTS mutes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guildId TEXT NOT NULL,
        userId TEXT NOT NULL,
        duration INTEGER NOT NULL,
        reason TEXT
    );`, (err) => {
    if (err) {
        console.error(`Ошибка при создании таблицы мутов: ${err.message}`);
    }
});

// Функция для сохранения мута в базе данных
async function saveMuteToDatabase(guildId, userId, duration, reason) {
    return new Promise((resolve, reject) => {
        const query = `INSERT INTO mutes (guildId, userId, duration, reason) VALUES (?, ?, ?, ?)`;
        mutesDb.run(query, [guildId, userId, duration, reason], function (err) {
            if (err) {
                console.error(`Ошибка при сохранении мута: ${err.message}`);
                reject(err);
            } else {
                resolve(this.lastID);
            }
        });
    });
}

// Функция для получения мута из базы данных
async function getMuteFromDatabase(userId) {
    return new Promise((resolve, reject) => {
        const query = `SELECT * FROM mutes WHERE userId = ?`;
        mutesDb.get(query, [userId], (err, row) => {
            if (err) {
                console.error(`Ошибка при получении мута: ${err.message}`);
                reject(err);
            } else {
                resolve(row);
            }
        });
    });
}

// Функция для удаления мута из базы данных
async function removeMuteFromDatabase(robot, guildId, userId) {
    const serverSettings = await getServerSettings(guildId);
    const mutedRoleName = serverSettings.mutedRoleName;
    const logChannelName = serverSettings.logChannelName;
    const muteLogChannelName = serverSettings.muteLogChannelName;
    const muteLogChannelNameUse = serverSettings.muteLogChannelNameUse;
    const guild = robot.guilds.cache.get(guildId);
    if (!guild) {
        console.error(`Гильдия с ID ${guildId} не найдена`);
        return;
    }

    const mutedRole = guild.roles.cache.find(role => role.name === mutedRoleName);

    if (!mutedRole) {
        console.error(`Роль мута не найдена для гильдии ${guildId}`);
        return;
    }

    const memberToMute = await guild.members.fetch(userId);
    if (!memberToMute) {
        console.error(`Участник с ID ${userId} не найден в гильдии ${guildId}`);
        return;
    }

    try {
        await memberToMute.roles.remove(mutedRole.id);

        // Удаление записи мута из базы данных
        const query = 'DELETE FROM mutes WHERE userId = ? AND guildId = ?';
        const params = [userId, guildId];
        await mutesDb.run(query, params);

        let logChannel;
        if (muteLogChannelNameUse) {
            logChannel = guild.channels.cache.find(ch => ch.name === muteLogChannelName);
        } else {
            logChannel = guild.channels.cache.find(ch => ch.name === logChannelName);
        }
        if (!logChannel) {
            const channelNameToCreate = muteLogChannelNameUse ? muteLogChannelName : logChannelName;
            const roles = guild.roles.cache;
            const higherRoles = [...roles.values()].filter(role => botMember.roles.highest.comparePositionTo(role) < 0);
            const logChannelCreationResult = await createLogChannel(robot, guild, channelNameToCreate, botMember, higherRoles, serverSettings);

            if (logChannelCreationResult.startsWith('Ошибка')) {
                console.error(`Ошибка при создании канала: ${logChannelCreationResult}`);
            }

            logChannel = guild.channels.cache.find(ch => ch.name === channelNameToCreate);
        }

        await logChannel.send(i18next.t('mutesDb-js_removeExpiredMutes_log', { userId: userId })).catch(console.error);

        return;
    } catch (error) {
        console.error(`Ошибка при удалении роли мута с участника ${userId}: ${error}`);
        return;
    }
}

// Функция для получения всех активных мутов
async function getAllActiveMutes() {
    return new Promise((resolve, reject) => {
        const query = `SELECT * FROM mutes WHERE duration > ?`;
        mutesDb.all(query, [Date.now()], (err, rows) => {
            if (err) {
                console.error(`Ошибка при получении активных мутов: ${err.message}`);
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}

// Функция для получения истёкших мутов из базы данных
async function getExpiredMutes(guildId) {
    const currentTime = Date.now();

    const query = 'SELECT * FROM mutes WHERE duration <= ? AND guildId = ?';
    const params = [currentTime, guildId];

    try {
        return new Promise((resolve, reject) => {
            mutesDb.all(query, params, (err, rows) => {
                if (err) {
                    console.error(`getExpiredMutes: An error occurred: ${err.message}`);
                    reject(err);
                } else {

                    const processedRows = rows.map(row => ({
                        ...row,
                        duration: new Date(row.duration).toLocaleString('ru-RU'),
                        isExpired: currentTime >= row.duration,
                    }));

                    resolve(processedRows.filter(row => row.isExpired));
                }
            });
        });
    } catch (err) {
        console.error(`getExpiredMutes: An error occurred: ${err.message}`);
        throw err;
    }
}

// Асинхронная функция для удаления истекших мутов
async function removeExpiredMutes(robot, guildId) {
    const guild = robot.guilds.cache.get(guildId);
    if (!guild) {
        console.error(`Гильдия с ID ${guildId} не найдена.`);
        return;
    }

    try {

        const botMember = await guild.members.fetch(robot.user.id);
        if (!botMember) {
            console.error('Не удалось получить бота как участника гильдии.');
            return;
        }

        const expiredMutes = await getExpiredMutes(guildId);
        if (expiredMutes.length === 0) {
            return;
        }

        for (const mute of expiredMutes) {
            try {

                const member = await guild.members.fetch(mute.userId).catch(() => null);
                if (!member) {
                    console.error(`Пользователь с ID ${mute.userId} не найден на сервере.`);
                    continue;
                }

                await removeMuteFromDatabase(robot, guildId, mute.userId);


            } catch (error) {
                console.error(`Ошибка при удалении мута для пользователя с ID: ${mute.userId}: ${error}`);
            }
        }

    } catch (error) {
        console.error(`Ошибка при удалении истекших мутов: ${error}`);
    }
}

// Экспорт функций для работы с мутами
module.exports = {
    saveMuteToDatabase,
    getMuteFromDatabase,
    getAllActiveMutes,
    getExpiredMutes,
    removeMuteFromDatabase,
    removeExpiredMutes
};