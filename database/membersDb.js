// Подключаем библиотеку dotenv для загрузки переменных окружения из файла .env
require('dotenv').config();

// Подключаем библиотеку sqlite3 для работы с базой данных SQLite
const sqlite3 = require('sqlite3').verbose();

// Подключаем библиотеку path для работы с путями файлов
const path = require('path');

// Проверка определена ли переменная окружения для пути к базе данных участников
if (!process.env.SQLITE_MEMBERS_DB_PATH) {
    console.error('Переменная окружения SQLITE_MEMBERS_DB_PATH не определена.');
    process.exit(1);
}

// Получение полного пути к файлу базы данных участников
const membersDbPath = path.resolve(process.env.SQLITE_MEMBERS_DB_PATH);

// Создание и открытие базы данных
const membersDb = new sqlite3.Database(membersDbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error('Ошибка подключения к базе данных:', err.message);
    } else {
        console.log('Подключено к базе данных участников.');

        // Создаем таблицу members, если она не существует
        membersDb.exec(`CREATE TABLE IF NOT EXISTS members (
            userId TEXT NOT NULL,
            guildId TEXT NOT NULL,
            roles TEXT,
            PRIMARY KEY (userId, guildId)
        );`, (err) => {
            if (err) {
                console.error('Ошибка при создании таблицы:', err.message);
            }
        });

        // Создаем индекс после подключения к базе данных
        membersDb.exec('CREATE INDEX IF NOT EXISTS idx_members_guildId_userId ON members (guildId, userId);', (indexErr) => {
            if (indexErr) {
                console.error('Ошибка создания индекса:', indexErr.message);
            }
        });
    }
});

// Функция для получения ID участников сервера с кэшированием в SQLite
async function getAllMemberIds(guild) {
    if (!guild) {
        console.error('Guild объект не предоставлен');
        throw new Error('Guild объект не предоставлен');
    }

    try {
        // список участников из базы данных
        const rows = await new Promise((resolve, reject) => {
            membersDb.all('SELECT userId FROM members WHERE guildId = ?', [guild.id], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        // Если есть записи в базе данных, возвращаем ID участников
        if (rows.length > 0) {
            return rows.map(row => row.userId);
        } else {
            // Если нет записей в базе данных, получаем всех участников сервера
            const members = await guild.members.fetch();
            const memberData = members.map(member => ({
                id: member.id,
                roles: member.roles.cache.map(role => role.name).join(', ')
            }));

            // Начало транзакции
            await membersDb.run('BEGIN TRANSACTION');

            // Подготовка запроса для массовой вставки с ролями
            const insertQuery = `INSERT INTO members (guildId, userId, roles) VALUES ${memberData.map(() => '(?, ?, ?)').join(',')}`;
            const insertValues = memberData.reduce((acc, { id, roles }) => [...acc, guild.id, id, roles], []);

            // Выполнение массовой вставки
            await membersDb.run(insertQuery, insertValues);

            // Завершение транзакции
            await membersDb.run('COMMIT');
        }
    } catch (error) {
        console.error('Ошибка при работе с базой данных:', error);
        await new Promise((resolve, reject) => {
            membersDb.run('ROLLBACK', (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        throw error; // Перебрасываем ошибку дальше
    }
}

// Функция для получения пользователя по ID
async function getMember(guild, userId) {
    try {
        const memberInfo = await new Promise((resolve, reject) => {
            membersDb.get('SELECT * FROM members WHERE guildId = ? AND userId = ?', [guild.id, userId], (err, row) => {
                if (err) reject(err);
                else resolve(row || {});
            });
        });
        return memberInfo;
    } catch (error) {
        console.error(error);
        return {};
    }
}

// Функция для удаления ненужных записей из базы данных
async function removeStaleMembers(guild) {
    const allMemberIds = await guild.members.fetch().then(members => members.map(member => member.id));

    return new Promise((resolve, reject) => {
        membersDb.run('DELETE FROM members WHERE guildId = ? AND userId NOT IN (' + allMemberIds.map(() => '?').join(',') + ')', [guild.id, ...allMemberIds], function(err) {
            if (err) {
                console.error('Ошибка при удалении устаревших участников:', err.message);
                reject(err);
            } else {
                console.log(`Удалено ${this.changes} устаревших записей участников из базы данных.`);
                resolve();
            }
        });
    });
}

// Функция для обновления информации о ролях участников
async function updateMembersInfo(robot) {
    for (const guild of robot.guilds.cache.values()) {
        // Удаляем устаревшие записи
        await removeStaleMembers(guild);

        // Получаем всех участников сервера
        const members = await guild.members.fetch();

        // Начало транзакции
        await membersDb.run('BEGIN TRANSACTION');

        // Обновляем информацию о ролях для каждого участника
        for (const member of members.values()) {
            const roles = member.roles.cache.map(role => role.name).join(', ');
            await new Promise((resolve, reject) => {
                membersDb.run('INSERT OR REPLACE INTO members (guildId, userId, roles) VALUES (?, ?, ?)', [guild.id, member.id, roles], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        }

        // Завершение транзакции
        await membersDb.run('COMMIT');
    }
}

// Функция для сохранения информации об участнике в базе данных
function saveMemberInfoToDatabase(userId, guildId) {
    // Подготовка SQL-запроса для вставки информации об участнике
    const insertStmt = membersDb.prepare('INSERT INTO members (userId, guildId) VALUES (?, ?)');

    // Выполнение SQL-запроса с предоставленными данными
    insertStmt.run([userId, guildId], function (err) {
        if (err) {
            console.error('Ошибка при сохранении информации об участнике:', err.message);
        } else {
            console.log(`Информация об участнике была успешно сохранена.`);
        }
    });

    // Закрытие подготовленного SQL-заявления
    insertStmt.finalize();
}

module.exports = {
    getAllMemberIds,
    saveMemberInfoToDatabase,
    getMember,
    updateMembersInfo
};
