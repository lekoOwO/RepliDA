const CONSOLE_ONLY_ROLE = "RepliDA_Console_Only";

const { proxmoxApi, ProxmoxEngine } = require('proxmox-api')
const config = require("../data/config")

const db = require("./db")

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"

const engine = new ProxmoxEngine(config.main)

async function getVnc(node, vmid, username) {
    const user = db.getUser(username)
    const promox = proxmoxApi({
        host: config.main.host,
        port: config.main.port,
        username: user.username,
        password: user.password
    })
    const { password, port, ticket } = await promox.nodes.$(node).qemu.$(vmid).vncproxy.$post({
        websocket: true,
        "generate-password": true
    })
    return { password, port, ticket }
}

async function isVmExist(node, vmid) {
    try {
        const promox = proxmoxApi(engine)
        await promox.nodes.$(node).qemu.$(vmid).status.current.$get()
        return true;
    } catch (e) {
        return false;
    }
}

async function isVmAlive(node, vmid) {
    try {
        const promox = proxmoxApi(engine)
        const data = await promox.nodes.$(node).qemu.$(vmid).status.current.$get();
        return data.status === "running";
    } catch (e) {
        return false;
    }
}

async function getVmName(node, vmid) {
    try {
        const promox = proxmoxApi(engine)
        const data = await promox.nodes.$(node).qemu.$(vmid).status.current.$get();
        return data.name;
    } catch (e) {
        return false;
    }
}

async function isSerial(node, vmid) {
    try {
        const promox = proxmoxApi(engine)
        const data = await promox.nodes.$(node).qemu.$(vmid).config.$get();
        return !!Object.keys(data).find(x => x.startsWith("serial"))
    } catch (e) {
        return false;
    }
}

async function cloneVm(node, vmid, newid, name, type="qemu") {
    const promox = proxmoxApi(engine)
    if (await isVmExist(node, newid)) {
        return false;
    }
    await promox.nodes.$(node).qemu.$(vmid).clone.$post({
        newid,
        name,
        full: true
    })
    const cloned = await promox.nodes.$(node).qemu.$(newid).status.current.$get();
    return cloned.vmid.toString() === newid.toString();
}

async function startVm(node, vmid) {
    const promox = proxmoxApi(engine)
    await promox.nodes.$(node).qemu.$(vmid).status.start.$post()
}

async function stopVm(node, vmid) {
    const promox = proxmoxApi(engine)
    await promox.nodes.$(node).qemu.$(vmid).status.stop.$post()
}

async function rebootVm(node, vmid) {
    const promox = proxmoxApi(engine)
    await promox.nodes.$(node).qemu.$(vmid).status.reboot.$post();
}

async function shutdownVm(node, vmid) {
    const promox = proxmoxApi(engine)
    await promox.nodes.$(node).qemu.$(vmid).status.shutdown.$post()
}

async function dumpVm(node, vmid) {
    const promox = proxmoxApi(engine)
    const upid = await promox.nodes.$(node).vzdump.$post({
        all: false,
        vmid,
        mode: "stop",
        compress: "zstd",
        storage: config.main.dumpStorage
    })
    return upid;
}

async function genVmId() {
    let vmid = config.main.baseVmid;
    while (true) {
        if (db.isVmidOk(vmid) && !await isVmExist(config.main.node, vmid)) {
            return vmid;
        }
        vmid++;
    }
}

async function addUser(userid, password) {
    const promox = proxmoxApi(engine)
    await promox.access.users.$post({
        userid,
        password
    })
}

async function init() {
    const promox = proxmoxApi(engine)
    try {
        await promox.access.roles.$(CONSOLE_ONLY_ROLE).$get();
    } catch (e) {
        await promox.access.roles.$post({
            roleid: CONSOLE_ONLY_ROLE,
            privs: "VM.Console VM.PowerMgmt"
        })
    }
}

async function addPermission(username, vmid) {
    const promox = proxmoxApi(engine)
    await promox.access.acl.$put({
        path: `/vms/${vmid}`,
        users: username,
        roles: CONSOLE_ONLY_ROLE
    })
}


async function deletePermission(username, vmid) {
    const promox = proxmoxApi(engine)
    await promox.access.acl.$put({
        path: `/vms/${vmid}`,
        users: username,
        roles: CONSOLE_ONLY_ROLE,
        delete: true
    })
}

async function login(username) {
    const user = db.getUser(username)
    const promox = proxmoxApi({
        host: config.main.host,
        port: config.main.port,
        username: user.username,
        password: user.password
    })
    const { CSRFPreventionToken, ticket } = await promox.access.ticket.$post({
        username: user.username,
        password: user.password
    })
    return { CSRFPreventionToken, ticket };
}

async function getStatus(node, upid){
    const promox = proxmoxApi(engine)
    const data = await promox.nodes.$(node).tasks.$(upid).status.$get();
    return data;
}

async function getLog(node, upid){
    const promox = proxmoxApi(engine)
    const data = await promox.nodes.$(node).tasks.$(upid).log.$get();
    return data;
}

const initP = init();

module.exports = {
    getVnc,
    getTicket: () => engine.getTicket(),
    cloneVm,
    isVmExist,
    isVmAlive,
    getVmName,
    startVm,
    stopVm,
    rebootVm,
    shutdownVm,
    genVmId,
    dumpVm,
    addUser,
    initP,
    addPermission,
    deletePermission,
    login,
    isSerial,
    getStatus,
    getLog
}