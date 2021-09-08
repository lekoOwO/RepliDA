const fs = require('fs');
const child_process = require('child_process')
const devnull = require('dev-null');

const spawned = {};

class Spawn {
    constructor({script, args, options, logFile, errFile}){
        this.script = script;
        this.args = args;
        this.options = options;
        this.logFile = logFile;
        this.errFile = errFile;
        this.exitCode = null;
    }
    run(){
        const {script, args, options, logFile, errFile} = this;
        const child = child_process.spawn(script, args, options);

        child.stdout.pipe(fs.createWriteStream(logFile || devnull()));
        child.stderr.pipe(fs.createWriteStream(errFile || devnull()));

        child.on('close', (code) => {
            this.exitCode = code;
        });
    }
}

function spawn({id, metadata, script, args, options, logFile, errFile}){
    const spawnObj = new Spawn({script, args, options, logFile, errFile});
    spawned[id] = {spawnObj, metadata};
    spawnObj.run();
    return spawnObj;
}

function getRunningSpawned(){
    return Object.fromEntries(
        Object.entries(spawned)
            .filter(([_, {spawnObj}]) => spawnObj.exitCode !== 0)
            .map(([id, {spawnObj, metadata}]) => [id, {...metadata, isError: spawnObj.exitCode !== null}])
    );
}

function clearSpawned(id){
    delete spawned[id];
}

function getSpawnedMetadata(id){
    return spawned[id].metadata;
}

const clearFinishedSpawned = setInterval(() => {
    let toBeDeleted = [];
    for(const [id, {spawnObj}] of Object.entries(spawned)){
        if(spawnObj.exitCode === 0){
            toBeDeleted.push(id);
        }
    }
    for(const id of toBeDeleted){
        delete spawned[id];
    }
}, 60 * 60 * 1000); // clear finished spawned every hour

module.exports = {
    Spawn,
    spawn,
    getRunningSpawned,
    getSpawnedMetadata,
    clearSpawned
}