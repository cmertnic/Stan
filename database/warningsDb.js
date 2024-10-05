// Загружаем переменные окружения
require('dotenv').config();
// Импортируем необходимые модули
const path = require('path');
const { PermissionsBitField } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const { getServerSettings } = require('../database/settingsDb');
const { i18next, t } = require('../i18n');
const { createLogChannel } = require('../events');

// Проверяем, определена ли переменная окружения для пути к базе данных предупреждений
if (!process.env.SQLITE_WARNINGS_DB_PATH) {
    console.error('Переменная окружения SQLITE_WARNINGS_DB_PATH не определена.');
    process.exit(1);
}

// Получаем полный путь к файлу базы данных предупреждений
const warningsDbPath = path.resolve(process.env.SQLITE_WARNINGS_DB_PATH);

// Инициализация базы данных предупреждений
const warningsDb = new sqlite3.Database(warningsDbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error('Ошибка подключения к базе данных предупреждений:', err.message);
    } else {
        console.log('Подключено к базе данных предупреждений.');
    }
});

// Создание таблицы предупреждений, если она ещё не существует
warningsDb.run(`CREATE TABLE IF NOT EXISTS warnings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guildId TEXT NOT NULL,
        userId TEXT NOT NULL,
        duration INTEGER NOT NULL,
        reason TEXT
    );`, (err) => {
    if (err) {
        console.error(`Ошибка при создании таблицы предупреждений: ${err.message}`);
    }
});

// Асинхронная функция для получения предупреждений пользователя
async function getUserWarnings(userId) {
    return new Promise((resolve, reject) => {
        warningsDb.all(`SELECT * FROM warnings WHERE userId = ?`, [userId], (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}

// Функция для сохранения предупреждения в базу данных
async function saveWarningToDatabase(interaction, userIdToWarn, durationMs, reason) {
    // Проверка входных данных и получение настроек сервера
    if (!interaction || !interaction.guild || !interaction.guild.id) {
        throw new Error('Не предоставлен объект interaction с необходимыми свойствами');
    }
    const serverSettings = await getServerSettings(interaction.guild.id);
    const warningDuration = serverSettings.warningDuration || 3600000;

    // Обработка причины предупреждения и времени действия
    if (!reason) {
        reason = i18next.t('defaultReason');
    }

    if (isNaN(durationMs) || durationMs <= 0) {
        durationMs = warningDuration;
    }

    const duration = Date.now() + durationMs;

    try {
        // Вставка новой записи в базу данных
        const result = await new Promise((resolve, reject) => {
            warningsDb.run(`INSERT INTO warnings (guildId, userId, duration, reason) VALUES (?, ?, ?, ?)`, [interaction.guild.id, userIdToWarn, duration, reason], function (err) {
                if (err) {
                    console.error(`Ошибка при вставке в базу данных: ${err}`);
                    reject(err);
                } else {
                    resolve(this.lastID);
                }
            });
        });
        return result;
    } catch (error) {
        console.error(`Ошибка при сохранении предупреждения: ${error}`);
        throw error;
    }
}

// Асинхронная функция для получения истекших предупреждений
async function getExpiredWarnings(robot, guildId) {
    try {
        const currentTime = Date.now(); // Текущее время в формате временной метки Unix

        // Проверка наличия необходимых свойств у объекта robot
        if (!robot || !robot.guilds || !robot.guilds.cache) {
            console.error('Некорректный объект robot.');
            return [];
        }

        // Получение сервера по ID и проверка его существования
        const guild = await robot.guilds.fetch(guildId).catch(console.error);
        if (!guild) {
            console.error(`Ошибка: Сервер с ID ${guildId} не найден.`);
            return [];
        }

        // Получение истекших предупреждений с использованием async/await
        const rows = await new Promise((resolve, reject) => {
            warningsDb.all(`SELECT * FROM warnings WHERE duration <= ? AND guildId = ?`, [currentTime, guildId], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });

        return rows || [];
    } catch (error) {
        console.error(`Ошибка при получении истекших предупреждений: ${error}`);
        return [];
    }
}

// Асинхронная функция для получения всех активных предупреждений
async function getAllActiveWarnings(guildId) {
    const currentTime = Date.now();

    return new Promise((resolve, reject) => {
        warningsDb.all(`SELECT * FROM warnings WHERE duration > ? AND guildId = ?`, [currentTime, guildId], (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}

// Функция для удаления предупреждения из базы данных
async function removeWarningFromDatabase(robot, guildId, userId) {
    return new Promise((resolve, reject) => {
        const query = `DELETE FROM warnings WHERE id = (
            SELECT id FROM warnings
            WHERE userId =? AND guildId =?
            ORDER BY duration DESC
            LIMIT 1
        )`;
        warningsDb.run(query, [userId, guildId], async function (err) {
            if (err) {
                console.error(`Ошибка при удалении предупреждения: ${err.message}`);
                reject(err);
            } else {
                const result = await new Promise((resolve, reject) => {
                    warningsDb.get(`SELECT COUNT(*) AS count FROM warnings WHERE userId =? AND guildId =?`, [userId, guildId], (err, row) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(row.count);
                        }
                    });
                });
                resolve(result);

                // Оповещение об успешном удалении предупреждения
                if (robot) {
                    const guild = robot.guilds.cache.get(guildId);
                    const member = await guild.members.fetch(userId).catch(console.error);
                    if (member && member.permissions.has(PermissionsBitField.Flags.SendMessages)) {
                        const message = i18next.t('warningsDb-js_removeMuteFromDatabase_member_send');
                        await member.send(message).catch(console.error);
                    }
                } else {
                    console.error('Ошибка: robot или robot.guilds не определены.');
                }
            }
        });
    });
}

// Асинхронная функция для получения количества предупреждений пользователя
async function getWarningsCount(userIdToWarn) {
    userIdToWarn = String(userIdToWarn);

    try {
        const result = await new Promise((resolve, reject) => {
            warningsDb.get(`SELECT COUNT(*) AS count FROM warnings WHERE userId = ?`, [userIdToWarn], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row.count);
                }
            });
        });
        return result;
    } catch (error) {
        console.error(`Ошибка при получении количества предупреждений: ${error}`);
        return 0;
    }
}

// Функция для удаления истекших предупреждений
async function removeExpiredWarnings(robot, guildId) {
    const guild = robot.guilds.cache.get(guildId);

    // Получение настроек сервера
    const serverSettings = await getServerSettings(guildId);
    const logChannelName = serverSettings.logChannelName;
    const warningLogChannelName = serverSettings.warningLogChannelName;
    const warningLogChannelNameUse = serverSettings.warningLogChannelNameUse;

    // Получение бота как участника сервера
    const botMember = await guild.members.fetch(robot.user.id);

    // Определение канала для логирования
    let logChannel;
    if (warningLogChannelNameUse) {
        logChannel = guild.channels.cache.find(ch => ch.name === warningLogChannelName);
    } else {
        logChannel = guild.channels.cache.find(ch => ch.name === logChannelName);
    }

    if (!logChannel) {
        try {
            const channelNameToCreate = warningLogChannelNameUse ? warningLogChannelName : logChannelName;
            const roles = guild.roles.cache;
            const higherRoles = [...roles.values()].filter(role => botMember.roles.highest.comparePositionTo(role) < 0);
            const logChannelCreationResult = await createLogChannel(robot, guild, channelNameToCreate, botMember, higherRoles, serverSettings);

            // Выход из функции, если произошла ошибка при создании канала
            if (logChannelCreationResult.startsWith('Ошибка')) {
                console.error(`Ошибка при создании канала: ${logChannelCreationResult}`);
            }

            // Переопределяем переменную logChannel, так как она теперь может содержать новый канал
            logChannel = guild.channels.cache.find(ch => ch.name === channelNameToCreate);
        } catch {
            logChannel = logChannelName;
        }

    }
    // Получение истекших предупреждений
    const expiredWarnings = await getExpiredWarnings(robot, guildId);
    if (!expiredWarnings || expiredWarnings.length === 0) {
        return;
    }

    // Обработка каждого истекшего предупреждения
    for (const warning of expiredWarnings) {
        try {
            // Получение пользователя по ID
            const member = await guild.members.fetch(warning.userId).catch(console.error);
            if (!member) {
                console.error(`- Ошибка: Пользователь с ID ${warning.userId} не найден на сервере.`);
                continue;
            }

            // Удаление предупреждения из базы данных
            const warningsCount = await getWarningsCount(warning.userId);
            if (warningsCount === 0) {
                console.error(`- Ошибка: Предупреждение для пользователя с ID ${warning.userId} не найдено.`);
                continue;
            }

            await removeWarningFromDatabase(robot, guildId, warning.userId);

            await logChannel.send(i18next.t('warningsDb-js_removeExpiredWarnings_log', { userId: warning.userId })).catch(console.error);
        } catch (error) {
            console.error(`- Ошибка при удалении предупреждения для пользователя с ID: ${warning.userId}: ${error}`);
        }
    }
}

// Экспорт функций для работы с предупреждениями
module.exports = {
    getUserWarnings,
    saveWarningToDatabase,
    getExpiredWarnings,
    removeWarningFromDatabase,
    removeExpiredWarnings,
    getWarningsCount,
    getAllActiveWarnings
};