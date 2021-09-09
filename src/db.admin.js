const sqlite3 = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data', 'admin.sqlite3');
const db = sqlite3(DB_PATH);

db.exec(`
    CREATE TABLE IF NOT EXISTS "SUBMITS" (
        "id"	    INTEGER PRIMARY KEY AUTOINCREMENT,
        "user"	    TEXT NOT NULL,
        "vmid"      INTEGER NOT NULL,
        "vmname"    TEXT NOT NULL,
        "dump_path" TEXT NOT NULL,
        "upid"      TEXT NOT NULL,
        "time"      DATETIME NOT NULL,
        "read"      BOOLEAN NOT NULL CHECK (read IN (0, 1))
    );
    CREATE TABLE IF NOT EXISTS "ERRORS" (
        "id"	        INTEGER PRIMARY KEY AUTOINCREMENT,
        "user"	        TEXT NOT NULL,
        "error_type"	TEXT NOT NULL,
        "vmid"          INTEGER NOT NULL,
        "vmname"        TEXT,
        "time"          DATETIME NOT NULL,
        "read"          BOOLEAN NOT NULL CHECK (read IN (0, 1))
    );
    CREATE TABLE IF NOT EXISTS "ADMIN_LOG" (
        "id"	        INTEGER PRIMARY KEY AUTOINCREMENT,
        "user"	        TEXT NOT NULL,
        "action"	    TEXT NOT NULL,
        "action_data"   TEXT,
        "table"         TEXT NOT NULL,
        "target_id"     INTEGER NOT NULL,
        "time"          DATETIME NOT NULL
    );
`)

function addSubmit(data) {
    const insert = db.prepare(`
        INSERT INTO SUBMITS (user, vmid, vmname, dump_path, upid, time, read)
        VALUES (@user, @vmid, @vmname, @dumpPath, @upid, @time, @read)
    `);
    return insert.run({
        ...data,
        time: Date.now(),
        read: 0
    });
}

function addError(data) {
    const insert = db.prepare(`
        INSERT INTO ERRORS (user, error_type, vmid, vmname, time, read)
        VALUES (@user, @errorType, @vmid, @vmname, @time, @read)
    `);
    return insert.run({
        ...data,
        time: Date.now(),
        read: 0
    });
}

function read(table) {
    return function(id, admin, actionData=null) {
        const insert = db.transaction(() => {
            db.prepare(`UPDATE SUBMITS SET read = 1 WHERE id = ?`).run(id);
            db.prepare(`
                INSERT INTO ADMIN_LOG (user, action, action_data, \`table\`, target_id, time)
                VALUES (@user, @action, @action_data, @table, @targetId, @time)
            `).run({
                user: admin,
                action: "read",
                table,
                action_data: JSON.stringify(actionData),
                targetId: id,
                time: Date.now()
            })
        })
        return insert();
    }
}

const readSubmit = read("SUBMITS");
const readError = read("ERRORS");

function getSubmits() {
    const select = db.prepare(`
        SELECT *
        FROM SUBMITS
        WHERE read = 0
    `);
    return select.all();
}

function getSubmitById(id) {
    const select = db.prepare(`
        SELECT *
        FROM SUBMITS
        WHERE id = ?
    `);
    return select.get(id);
}

function getErrors() {
    const select = db.prepare(`
        SELECT *
        FROM ERRORS
        WHERE read = 0
    `);
    return select.all();
}

function getLogs(limit = 15) {
    const select = db.prepare(`
        SELECT *
        FROM ADMIN_LOG
        TOP LIMIT ?
    `);
    return select.all(limit);
}

function getStatistics(){
    const select = db.prepare(`
        SELECT 
            COUNT(*) AS count, 
            SUM(read) AS read,
            COUNT(
                CASE WHEN time > @time THEN 1 ELSE null END
            ) AS diffCount,
            SUM(
                CASE WHEN time > @time THEN read ELSE 0 END
            ) AS diffRead
        FROM SUBMITS
    `);
    return select.get({
        time: Date.now() - 1000 * 60 * 60 * 24 * 7
    });
}

module.exports = {
    addSubmit,
    addError,
    readSubmit,
    readError,
    getSubmits,
    getErrors,
    getLogs,
    getSubmitById,
    getStatistics
}