module.exports = {
    "main": {
        "host": "my.pve.host",
        "port": 8006,
        "tokenID": "root@pam!RepliDA",
        "tokenSecret": "TOKEN_SECRET_USUALLY_A_UUID",
        "node": "NODE_NAME",
        "templates": {
            "Alpine Linux": 1001 // [Custom template name which shows on website]: ID of the template
        },
        "dumpStorage": "local", // storage name where the dump will be stored
        "baseVmid": 1069000 // base vmid for the new VM
    },
    "scripts": {
        "Test": "/home/leko/test"
    },
    "logDir": "/tmp",
    "port": 3010, // port for the web server
    "sessionSecret": "test123", // secret for the session cookie
    "loginUrl": "YOUR_LOGIN_MODULE_ENDPOINT", // url for the login page, see RepliDA's login modules.
    "callbackJwtSecret": ""
}