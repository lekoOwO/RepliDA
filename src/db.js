const path = require("path")
const DB_FILE_PATH = path.join(__dirname, "..", "data", "db.json");

const fs = require("fs-extra");
let db;

if (fs.pathExistsSync(DB_FILE_PATH)) {
    db = fs.readJSONSync(DB_FILE_PATH);
} else {
    db = {
        vms: {},
        users: {}
    };
    fs.writeJSONSync(DB_FILE_PATH, db)
}

async function saveDB() {
    await fs.writeJSON(DB_FILE_PATH, db);
}

function getVm(username) {
    if (db.vms.hasOwnProperty(username)) {
        return db.vms[username].id;
    }
    return false;
}

async function setVm(username, id) {
    db.vms[username] = {
        id
    };
    await saveDB();
}

async function deleteVm(username) {
    delete db.vms[username];
    await saveDB();
}

function isVmidOk(vmid) {
    for (const { id } of Object.values(db.vms)) {
        if (id == vmid) {
            return false;
        }
    }
    return true;
}

function getUser(username) {
    if (db.users.hasOwnProperty(username)) {
        return db.users[username];
    }
    return false;
}

async function setUser(username, pveusername, password) {
    db.users[username] = {
        username: pveusername,
        password
    };
    await saveDB();
}

module.exports = {
    getVm,
    setVm,
    deleteVm,
    isVmidOk,
    getUser,
    setUser
}