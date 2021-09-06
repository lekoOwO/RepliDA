process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"

const config = require("../data/config")
const { createProxyMiddleware } = require('http-proxy-middleware')

const express = require('express')
const proxmoxApi = require('./proxmoxApi')
const utils = require('./utils')
const db = require('./db')
const dbAdmin = require('./db.admin');

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
    const token = req.params.token;
    if (!token) {
        return res.redirect(config.loginUrl);
    }
    
    try {
        const {email, isAdmin} = await utils.verifyLogin(token);
        const username = utils.sanitizeUsername(email);
        req.session.username = username;
        req.session.isAdmin = isAdmin;

        const user = db.getUser(email);
        if (!user) {
            const pveUsername = "RepliDA-" + username + "@pve";
            const pvePassword = utils.generatePassword();
            await proxmoxApi.addUser(pveUsername, pvePassword);
            await db.setUser(username, pveUsername, pvePassword);
        }
        res.redirect(isAdmin ? "/admin" : "/");
    } catch (e){
        return res.sendStatus(403);
    }
})
/* ----- Login END ----- */

/* ----- Console ----- */
app.use("/novnc", express.static(__dirname + '/public/noVNC'))
app.use("/xterm", express.static(__dirname + '/public/xterm'))

app.get("/console/vnc", reqLogin, async (req, res) => {
    const username = req.session.username;
    const vmid = db.getVm(username);

    const { CSRFPreventionToken, pveCookie } = req.session;
    const token = await utils.encJwt({ pveCookie, CSRFPreventionToken });
    const link = await utils.getVncLink(vmid, username, token);

    res.redirect(link);
})

app.get("/console/xterm", reqLogin, async (req, res) => {
    const username = req.session.username;
    const vmid = db.getVm(username);
    const user = db.getUser(username);
    const link = await utils.getXtermLink(vmid, user.username, req.session.CSRFPreventionToken);
    res.redirect(link);
})

app.post("/token", reqLogin, async (req, res) => {
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

app.get("/vmStatus", reqLogin, async (req, res) => {
    const username = req.session.username;
    const vmid = db.getVm(username);
    if (!vmid) return res.json(false);

    const data = await proxmoxApi.isVmAlive(config.main.node, vmid);
    res.json(data);
})

app.get("/vm", reqLogin, async (req, res) => {
    const username = req.session.username;
    const vmid = db.getVm(username);
    if (!vmid || !await proxmoxApi.isVmExist(config.main.node, vmid)) {
        return res.json(false);
    }
    const isSerial = await proxmoxApi.isSerial(config.main.node, vmid);
    res.json({vmid, isSerial});
})

app.post("/vm", reqLogin, async (req, res) => {
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

app.post("/vm/operation", reqLogin, async (req, res) => {
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

app.post("/submit", reqLogin, async (req, res) => {
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
    let logs = null;
    while(!logs) {
        await utils.sleep(2000);
        logs = await proxmoxApi.getLog(config.main.node, dumpUpid);
    }
    const dumpPath = utils.getDumpPathFromLog(logs);

    dbAdmin.addSubmit({
        user: req.session.username,
        vmid,
        vmname,
        dumpPath,
        upid: dumpUpid
    });
})
/* ----- Main END ----- */

/* ----- Admin ----- */

/* ----- Admin END ----- */
app.listen(config.port);