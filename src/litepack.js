const { program, action } = require('commander');
const fs = require("fs");
const path = require("path")
const sha256File = require('sha256-file');
const hash = require('object-hash');
const colors = require('colors');
const AdmZip = require('adm-zip');

const prefs = 'litepack.preferences.json'
const KEEP = 'KEEP';
const UPDATE = 'UPDATE';
const REMOVE = 'REMOVE';
const ADD = 'ADD';

program.version('1.0.0');
program.description('litepack, for all your update management needs');
program.option('-f, --file <updatePath>', 'Update the game with the specified update file');
program.option('-p, --path <installPath>', 'Path to app');
program.option('-d, --diff <newReleasePath>', 'Path to the new version of the app to check what files differ');
program.option('-g, --gen <version>', 'Generates an update file for shipping');

function replaceAll(str, find, replace) {
    return str.replace(new RegExp(find, 'g'), replace);
}

function transform(program) {
    return {
        installPath: program.path,
        updatePath: program.file,
        diff: program.diff
    }
}

function isValid(options) {
    return options.installPath != undefined && options.updatePath != undefined;
}

function saveOptionsToFile(options) {
    fs.writeFileSync("./litepack.preferences.json", JSON.stringify(options, null, 4));
}

function getRelativePath(file, path) {
    let p = replaceAll(file.split(path)[1], "\\\\", "/");
    if (p.charAt(0) == "/" || p.charAt(0) == "\\") {
        p = p.substring(1);
    }
    return p;
}

function getAllFiles(dirPath, arrayOfFiles) {
    files = fs.readdirSync(dirPath)

    arrayOfFiles = arrayOfFiles || []

    files.forEach(function (file) {
        if (fs.statSync(dirPath + "/" + file).isDirectory()) {
            arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles)
        } else {
            arrayOfFiles.push(path.join(dirPath, "/", file))
        }
    })

    return arrayOfFiles
}

function generateHashes(path) {
    console.log(`litepack: processing files at: ${path}`)
    let files = getAllFiles(path);
    let fileHashes = {};
    files.forEach(file => {
        const relativePath = getRelativePath(file, path)
        fileHashes[relativePath] = sha256File(file);
        console.log(`litepack: processed file: ${relativePath} hash: [${fileHashes[relativePath]}]`);
    });
    console.log(`litepack: done processing ${files.length} files`)
    return fileHashes;
}

function describeDiff(diff) {
    let changedFiles = 0;
    let newFiles = 0;
    let oldFiles = 0;
    Object.keys(diff).forEach(file => {
        if (diff[file].action == UPDATE) {
            changedFiles++;
        }

        if (diff[file].action == ADD) {
            newFiles++;
        }

        if (diff[file].action == REMOVE) {
            oldFiles++;
        }
    });
    console.log(`litepack: files to update ${changedFiles}, new files to add: ${newFiles}, files to remove: ${oldFiles}`.cyan);
}

function compareFiles(fileHashesOld, fileHashesNew) {
    let diffs = {};
    let oldFiles = Object.keys(fileHashesOld);

    Object.keys(fileHashesNew).forEach(fileKey => {
        if (fileHashesOld[fileKey]) {
            // the file was found in the old files set
            if (fileHashesNew[fileKey] == fileHashesOld[fileKey]) {
                // the file hasn't changed
                diffs[fileKey] = {
                    hash: fileHashesOld[fileKey],
                    action: KEEP,
                }
                console.log(`litepack: found match for file: ${fileKey}, new: ${fileHashesNew[fileKey]} old: ${fileHashesOld[fileKey]}`.green);
            } else {
                // the file has changed
                diffs[fileKey] = {
                    hash: fileHashesOld[fileKey],
                    action: UPDATE,
                }
                console.log(`litepack: found changes to file: ${fileKey}, new: ${fileHashesNew[fileKey]} old: ${fileHashesOld[fileKey]}`.yellow);
            }
            oldFiles.splice(oldFiles.indexOf(fileKey), 1);
        } else {
            // this is a new file from the new file set
            diffs[fileKey] = {
                hash: fileHashesOld[fileKey],
                action: ADD,
            }
        }
    })

    oldFiles.forEach(oldFile => {
        diffs[oldFile] = {
            hash: fileHashesOld[oldFile],
            action: REMOVE,
        };
        console.log(`litepack: found deleted file: ${oldFile}`.magenta);
    })
    describeDiff(diffs);
    return diffs;
}

function dirName(filePath) {
    let p = path.dirname(filePath);
    if (p.charAt(0) == "/" || p.charAt(0) == "\\") {
        p = p.substring(1);
    }

    if (p.charAt(p.length - 1) != "/" && p.charAt(p.length - 1) != "\\") {
        p += path.sep;
    }
    return p;
}

function createUpdateZip(diffs, name, options) {
    const zip = new AdmZip();
    Object.keys(diffs).forEach(filePath => {
        if (diffs[filePath].action == UPDATE) {
            let zipFilePath = `${options.diff}/${filePath}`;
            console.log(`litepack: into zip: ${zipFilePath}`);
            zip.addLocalFile(`${zipFilePath}`, dirName(filePath));
        }
    });
    zip.addFile(`manifest.json`, JSON.stringify(diffs, null, 4));
    zip.writeZip(`${name}.zip`);
    console.log(`litepack: created zipfile`);
}

function diff(options) {
    let installedFilesHashes = generateHashes(options.installPath);
    let installedHash = hash(installedFilesHashes);
    console.log(`litepack: installed files collective hash: ${installedHash}`.cyan);
    console.log(`litepack: generating new update`);
    let newReleaseFilesHashes = generateHashes(options.diff);
    let newReleaseHash = hash(newReleaseFilesHashes);
    console.log(`litepack: new release files collective hash: ${installedHash}`.cyan);
    let diffs = compareFiles(installedFilesHashes, newReleaseFilesHashes);
    createUpdateZip(diffs, newReleaseHash, options);
}

function writeFileUpdates(manifest, options, zipEntries, zip) {
    console.log(`litepack: starting update`.cyan);
    zipEntries.forEach(function (zipEntry) {
        const entryName = zipEntry.entryName;
        if (entryName != "manifest.json") {
            if (manifest[entryName]) {
                const action = manifest[entryName].action;
                if (action == UPDATE || action == ADD) {
                    zip.extractEntryTo(entryName, `${options.installPath}/`, true, true);
                    console.log(`litepack: into directory (${action}): ${options.installPath}/${entryName}`.green);
                }
            }
        }
    });
    Object.keys(manifest).forEach(entry => {
        if (manifest[entry].action == REMOVE) {
            const removeFilePath = `${options.installPath}/${entry}`;
            if (fs.existsSync(removeFilePath)) {
                fs.unlinkSync(removeFilePath);
                console.log(`litepack: into directory (${manifest[entry].action}): ${removeFilePath}`.yellow);
            } else {
                console.log(`litepack: couldn't remove file because it was not found ${removeFilePath} `.red);
            }
        }
    });
}

function update(options) {
    console.log(`litepack: preparing to update using file ${options.updatePath}`);
    const updateZip = new AdmZip(options.updatePath);
    const zipEntries = updateZip.getEntries();
    let manifest = undefined;
    zipEntries.forEach(function (zipEntry) {
        if (zipEntry.entryName == "manifest.json") {
            manifest = JSON.parse(zipEntry.getData().toString('utf8'));
            describeDiff(manifest);
        }
    });
    if (manifest) {
        writeFileUpdates(manifest, options, zipEntries, updateZip);
    } else {
        throw new Error("corrupted update: manifest missing");
    }
}

function main() {
    program.parse(process.argv);
    console.log("litepack: is now loading, shouldn't take too long".cyan);

    let options = transform(program);
    if (!isValid(options)) {
        console.log('litepack: required options missing'.red);
        if (fs.existsSync(prefs)) {
            console.log('litepack: preferences found, using that');
            options = JSON.parse(fs.readFileSync(prefs));
        } else {
            console.log('litepack: preferences file not found, make sure to specify both file and path arguments!'.red);
        }
    }

    if (isValid(options)) {
        saveOptionsToFile(options);
        if (options.diff) {
            diff(options);
        } else if (options.updatePath) {
            update(options);
            console.log('litepack: finished'.rainbow);
        }
    } else {
        console.log('litepack: couldn\'t load litepack.'.red);
    }
}

try {
    main();
} catch (e) {
    console.log(`litepack: fatal error`.red, e);
}


