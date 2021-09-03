const crypto = require('crypto')
const qs = require('querystring')
const jwt = require('jsonwebtoken');
const base62 = require("base62/lib/ascii");

const proxmoxApi = require("./proxmoxApi")
const config = require("../data/config")

const generatePassword = (
    length = 15,
    wishlist = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
) =>
    Array.from(crypto.randomFillSync(new Uint32Array(length)))
        .map((x) => wishlist[x % wishlist.length])
        .join('')

async function getVncLink(vmid, username, token) {
    const { password, port, ticket } = await proxmoxApi.getVnc(config.main.node, vmid, username)
    const pathQuery = qs.stringify({
        port,
        vncticket: ticket,
        token
    })
    const path = `api2/json/nodes/${config.main.node}/qemu/${vmid}/vncwebsocket?${pathQuery}`
    const query = qs.stringify({
        path,
        encrypt: false,
        autoconnect: true,
        reconnect: true,
        password
    })

    return `/novnc/vnc.html?` + query
}

async function getXtermLink(vmid, username, CSRFPreventionToken) {
    const vmname = await proxmoxApi.getVmName(config.main.node, vmid);
    const query = qs.stringify({
        UserName: username,
        CSRFPreventionToken: CSRFPreventionToken,
        console: "kvm",
        vmid,
        node: config.main.node,
        vmname,
        cmd: ""
    })
    return "/xterm/index.html?" + query
}

function encJwt(data) {
    return new Promise((resolve, reject) => {
        jwt.sign({
            exp: Math.floor(Date.now() / 1000) + 10, // 10 sec exp.
            data
        }, config.sessionSecret, (err, token) => {
            if (err) reject(err)
            else resolve(token);
        });
    })
}

function decJwt(token) {
    const data = jwt.verify(token, config.sessionSecret);
    return data.data;
}

function verifyLogin(token){
    return new Promise((resolve, reject) => {
        jwt.verify(token, config.callbackJwtSecret, function(err, decoded) {
            if (err) reject(err)
            else resolve(decoded.data);
        });
    })
}

function getTokenFromURL(URL) {
    return qs.parse(URL).token;
}

function getDumpPathFromLog(logs){
    const log = logs.find(x => x.t.includes('.vma'))
    if (!log) return null;

    const path = log.t.substring(
        log.t.indexOf("'") + 1, 
        log.t.lastIndexOf("'")
    );
    return path
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function sanitizeUsername(username) {
    return base62.encode(username)
}

module.exports = {
    generatePassword,
    getVncLink,
    getXtermLink,
    encJwt,
    decJwt,
    verifyLogin,
    getTokenFromURL,
    getDumpPathFromLog,
    sleep,
    sanitizeUsername
}