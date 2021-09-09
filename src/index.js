process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"

const config = require("../data/config")
const { createProxyMiddleware } = require('http-proxy-middleware')

const express = require('express')
const proxmoxApi = require('./proxmoxApi')
const utils = require('./utils')
const db = require('./db')
const dbAdmin = require('./db.admin');
const runScript = require("./runScript");
const telegram = require("./notify/telegram")

const session = require('express-session')
const FileStore = require('session-file-store')(session)
const sessionConfig = {
    name: "RepliDA",
    store: new FileStore({}),
    secret: config.sessionSecret,
    resave: true,
    saveUninitialized: false,
    cookie: {
        httpOnly: true
    }
}

const reqLogin = (req, res, next) => {
    if (req.session.username) next()
    else res.redirect("/login")
}

const reqAdmin = (req, res, next) => {
    if (req.session.isAdmin) next()
    else return res.sendStatus(403)
}

const app = express()
app.use(express.json())
app.use(express.urlencoded())

const sessionMiddleware = session(sessionConfig);
app.use(sessionMiddleware);

/* ----- Login ----- */
app.get("/login", async(req, res) => {
    const token = req.query.token;
    if (!token) {
        return res.redirect(config.loginUrl);
    }

    try {
        const {email, isAdmin, name, picture} = await utils.verifyLogin(token);
        const username = utils.sanitizeUsername(email);
        req.session.username = username;
        req.session.isAdmin = isAdmin;
        req.session.name = name;
        req.session.picture = picture;

        const user = db.getUser(username);
        if (!user) {
            const pveUsername = "RepliDA-" + username + "@pve";
            const pvePassword = utils.generatePassword();
            await proxmoxApi.addUser(pveUsername, pvePassword);
            await db.setUser(username, pveUsername, pvePassword);
        }
        res.redirect(isAdmin ? "/admin" : "/");
    } catch (e){
        console.error(e)
        return res.sendStatus(403);
    }
})
/* ----- Login END ----- */

/* ----- Console ----- */
app.use("/novnc", express.static(__dirname + '/public/noVNC'))
app.use("/xterm", express.static(__dirname + '/public/xterm'))

app.get("/console/vnc", reqLogin, async(req, res) => {
    const username = req.session.username;
    const vmid = db.getVm(username);

    const { CSRFPreventionToken, pveCookie } = req.session;
    const token = await utils.encJwt({ pveCookie, CSRFPreventionToken });
    const link = await utils.getVncLink(vmid, username, token);

    res.redirect(link);
})

app.get("/console/xterm", reqLogin, async(req, res) => {
    const username = req.session.username;
    const vmid = db.getVm(username);
    const user = db.getUser(username);
    const link = await utils.getXtermLink(vmid, user.username, req.session.CSRFPreventionToken);
    res.redirect(link);
})

app.post("/token", reqLogin, async(req, res) => {
    const { CSRFPreventionToken, ticket } = await proxmoxApi.login(req.session.username);
    const pveCookie = "PVEAuthCookie=" + ticket;
    req.session.CSRFPreventionToken = CSRFPreventionToken;
    req.session.pveCookie = pveCookie;
    res.json(await utils.encJwt({ pveCookie, CSRFPreventionToken }));
})

function setProxyAuth(proxyReq, req) {
    if (!req.session) return console.log(':(')
    if (req.session.pveTicket) {
        proxyReq.setHeader('authorization', req.session.pveTicket);
    } else if (req.session.pveCookie) {
        proxyReq.setHeader('cookie', req.session.pveCookie);
        if (req.session.CSRFPreventionToken) {
            proxyReq.setHeader('CSRFPreventionToken', req.session.CSRFPreventionToken);
        }
    }
}

const apiProxy = createProxyMiddleware({
    target: `https://${config.main.host}:${config.main.port}`,
    ws: true,
    secure: false,
    changeOrigin: true,
    onProxyReq(proxyReq, req, res) {
        setProxyAuth(proxyReq, req)
    },
    onProxyReqWs(proxyReq, req, socket, options, head) {
        const token = utils.getTokenFromURL(req.url);
        if (token && !req.session) {
            const { pveCookie, CSRFPreventionToken } = utils.decJwt(token);
            req.session = { pveCookie, CSRFPreventionToken };
        }
        proxyReq.path = proxyReq.path.split("&token")[0]; // remove token from url, tricky
        setProxyAuth(proxyReq, req);
    }
})

// Becuz I'm lazy to deal with the url part
// since the api always starts with `/api2`
// I make `/api2` a proxy to main proxmox api.
app.use('/api2', (...args) => {
    try {
        apiProxy(...args)
    } catch (e) {
        console.error(e);
    }
})
/* ----- Console END ----- */

/* ----- Main ----- */
app.get("/", reqLogin, (req, res) => {
    res.sendFile(__dirname + '/public/app/index.html')
})

app.get("/templates", (req, res) => {
    return res.json(Object.keys(config.main.templates));
})

app.get("/vmStatus", reqLogin, async(req, res) => {
    const username = req.session.username;
    const vmid = db.getVm(username);
    if (!vmid) return res.json(false);

    const data = await proxmoxApi.isVmAlive(config.main.node, vmid);
    res.json(data);
})

app.get("/vm", reqLogin, async(req, res) => {
    const username = req.session.username;
    const vmid = db.getVm(username);
    if (!vmid || !await proxmoxApi.isVmExist(config.main.node, vmid)) {
        return res.json(false);
    }
    const isSerial = await proxmoxApi.isSerial(config.main.node, vmid);
    res.json({vmid, isSerial});
})

app.post("/vm", reqLogin, async(req, res) => {
    const username = req.session.username;
    const pveUsername = db.getUser(username).username;
    const fromTemplateName = req.body.template;

    if (!config.main.templates.hasOwnProperty(fromTemplateName)) {
        return res.sendStatus(400);
    }

    const fromVmid = config.main.templates[fromTemplateName];
    const vmid = db.getVm(username);
    if (!vmid || !await proxmoxApi.isVmExist(config.main.node, vmid)) {
        const newVmid = await proxmoxApi.genVmId();
        const clone = await proxmoxApi.cloneVm(config.main.node, fromVmid, newVmid, `${fromVmid}-${username}`);
        if (clone) {
            console.log(pveUsername)
            await proxmoxApi.addPermission(pveUsername, newVmid);
            db.setVm(username, newVmid);
            res.json(newVmid);
        } else {
            res.sendStatus(500);
        }
    } else {
        res.json(vmid);
    }
})

app.post("/vm/operation", reqLogin, async(req, res) => {
    const username = req.session.username;
    const vmid = db.getVm(username);
    if (!vmid) return res.sendStatus(400);

    const operation = req.body.operation;
    switch (operation) {
        case "stop":
            await proxmoxApi.stopVm(config.main.node, vmid);
            break;
        case "start":
            await proxmoxApi.startVm(config.main.node, vmid);
            break;
        case "reboot":
            await proxmoxApi.rebootVm(config.main.node, vmid);
            break;
        case "shutdown":
            await proxmoxApi.shutdownVm(config.main.node, vmid);
            break;
    }
    res.sendStatus(204);
})

app.post("/submit", reqLogin, async(req, res) => {
    const username = req.session.username;
    const vmid = db.getVm(username);
    if (!vmid) return res.sendStatus(400);

    db.deleteVm(username);
    res.sendStatus(204);

    const vmname = await proxmoxApi.getVmName(config.main.node, vmid);
    for (let i = 0; i < 3; i++) {
        if (!await proxmoxApi.isVmAlive(config.main.node, vmid)) {
            break;
        }
        await proxmoxApi.stopVm(config.main.node, vmid);
        if (!await proxmoxApi.isVmAlive(config.main.node, vmid)) {
            break;
        }
        if (i == 2) {
            // System Error. Cannot stop VM.
            return dbAdmin.addError({
                user: req.session.username,
                errorType: "SUBMIT_VM_STOP_ERROR",
                vmid,
                vmname
            })
        }
    }

    const dumpUpid = await proxmoxApi.dumpVm(config.main.node, vmid);
    let dumpPath = null;
    while(!dumpPath) {
        await utils.sleep(2000);
        const logs = await proxmoxApi.getLog(config.main.node, dumpUpid);
        dumpPath = utils.getDumpPathFromLog(logs);
    }

    const {lastInsertRowid} = dbAdmin.addSubmit({
        user: req.session.username,
        vmid,
        vmname,
        dumpPath,
        upid: dumpUpid
    });

    if (config.onSubmit.telegram.enable) {
        const tg = config.onSubmit.telegram;
        await telegram.trySendMessage(tg.botToken, tg.chatId, [
            "新的虛擬機器提交呀喲！",
            `<pre>ID:        ${lastInsertRowid}</pre>`,
            `<pre>User:      ${utils.decodeUsername(req.session.username)}</pre>`,
            `<pre>VMID:      ${vmid}</pre>`,
            `<pre>\n</pre>`,
            `<pre>Dump Path: ${dumpPath}</pre>`,
            `<pre>UPID:      ${dumpUpid}</pre>`
        ].join(""))
    }
})

app.get("/logout", reqLogin, async(req, res) => {
    req.session.destroy(() => {
        res.redirect("/");
    })
})
/* ----- Main END ----- */

/* ----- Admin ----- */

app.get("/admin", reqAdmin, async(req, res) => {
    return res.sendFile(__dirname + '/public/admin/index.html');
})

app.get("/admin/me", reqAdmin, async(req, res) => {
    const {username, isAdmin, name, picture} = req.session;
    return res.json({username, isAdmin, name, picture});
})

app.get("/admin/submit", reqAdmin, async(req, res) => {
    const data = dbAdmin.getSubmits().map(x => ({...x, user: utils.decodeUsername(x.user)}));
    res.json(data);
})

app.post("/admin/submit/read", reqAdmin, async(req, res) => {
    const id = req.body.id;
    const admin = req.session.username;
    dbAdmin.readSubmit(id, admin);
    res.sendStatus(204);
})

app.get("/admin/error", reqAdmin, async(req, res) => {
    const data = dbAdmin.getErrors();
    res.json(data);
})

app.post("/admin/error/read", reqAdmin, async(req, res) => {
    const id = req.body.id;
    const admin = req.session.username;
    dbAdmin.readError(id, admin);
    res.sendStatus(204);
})

app.get("/admin/log", reqAdmin, async(req, res) => {
    const data = dbAdmin.getLogs().map(x => ({...x, user: utils.decodeUsername(x.user)}));
    res.json(data);
})

app.get("/admin/script", reqAdmin, async(req, res) => {
    res.json(Object.keys(config.scripts));
})

app.post("/admin/readSubmit", reqAdmin, async(req, res) => {
    const {id} = req.body;
    const admin = req.session.username;

    dbAdmin.readSubmit(id, admin, {action: "deny"});
    if (config.onRead.telegram.enable) {
        const tg = config.onRead.telegram;
        await telegram.trySendMessage(tg.botToken, tg.chatId, [
            "🚫 提交: 否決",
            `<pre>ID:    ${id}</pre>`,
            `<pre>Admin: ${utils.decodeUsername(req.session.username)}</pre>`
        ].join(""))
    }
    res.sendStatus(204);
})

app.post("/admin/runScript", reqAdmin, async(req, res) => {
    const {id, script: scriptName} = req.body;
    const admin = req.session.username;

    if (!config.scripts.hasOwnProperty(scriptName)) {
        return res.sendStatus(400);
    }
    const script = config.scripts[scriptName];
    const submitData = dbAdmin.getSubmitById(id);

    dbAdmin.readSubmit(id, admin, {action: "approve", script: scriptName});
    if (config.onRead.telegram.enable) {
        const tg = config.onRead.telegram;
        await telegram.trySendMessage(tg.botToken, tg.chatId, [
            "✅ 提交: 核准",
            `<pre>ID:     ${id}</pre>`,
            `<pre>Admin:  ${utils.decodeUsername(req.session.username)}</pre>`,
            `<pre>Script: ${scriptName}</pre>`
        ].join(""))
    }

    const {logPath, errPath} = utils.generateLogPath(id);
    runScript.spawn({
        id: id,
        metadata: {...submitData, script: scriptName, logFile: logPath, errFile: errPath},
        script: script,
        args: [
            submitData.id,
            submitData.user,
            submitData.vmid,
            submitData.vmname,
            submitData.dump_path,
            submitData.upid
        ],
        logFile: logPath,
        errFile: errPath
    })
    res.sendStatus(204);
})

app.get("/admin/running", reqAdmin, async(req, res) => {
    let data = runScript.getRunningSpawned();
    data = JSON.parse(JSON.stringify(data));

    for(const k of Object.keys(data)){
        data[k].user = utils.decodeUsername(data[k].user);
    }

    res.json(data);
})

app.get("/admin/scriptResult", reqAdmin, async(req, res) => {
    const { id } = req.query;
    
    try {
        const {logFile, errFile} = runScript.getSpawnedMetadata(id);
        const {log, err} = await utils.readLogs(logFile, errFile);
        res.json({log, err});
    } catch (e) {
        res.sendStatus(500);
    }
})

app.post("/admin/clearSpawned", reqAdmin, async(req, res) => {
    const {id} = req.body;
    runScript.clearSpawned(id);
    res.sendStatus(204);
})

app.get("/admin/statistics", reqAdmin, async(req, res) => {
    res.json(dbAdmin.getStatistics());
})

/* ----- Admin END ----- */
app.listen(config.port);